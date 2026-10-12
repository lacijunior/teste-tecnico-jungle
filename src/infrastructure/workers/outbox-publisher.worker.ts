import { EnsureRequestContext, MikroORM } from '@mikro-orm/core';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  MESSAGE_PUBLISHER,
  type MessagePublisher,
} from '../../application/ports/message-publisher.js';
import { CLOCK, type Clock } from '../../application/ports/clock.js';
import { OutboxMessageEntity } from '../persistence/mikro-orm/entities/outbox-message.entity.js';
import { OutboxMessageRepository } from '../persistence/mikro-orm/repositories/outbox-message.repository.js';
import { OutboxMessageMapper } from '../persistence/mikro-orm/mappers/outbox-message.mapper.js';
import { outboxConfig, sqsConfig } from '../config/wagering.config.js';
import {
  outboxLagSeconds,
  outboxPublishedTotal,
  outboxPublishRetriesTotal,
} from '../observability/metrics.js';

@Injectable()
export class OutboxPublisherWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherWorker.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private runningTick: Promise<void> = Promise.resolve();

  constructor(
    private readonly orm: MikroORM,
    @Inject(MESSAGE_PUBLISHER) private readonly publisher: MessagePublisher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public onModuleInit(): void {
    this.scheduleNext(0);
  }

  public async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    await this.runningTick;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.runningTick = this.tick()
        .catch((error: unknown) => this.logger.error('outbox publisher tick failed', error))
        .finally(() => this.scheduleNext(outboxConfig.pollIntervalMs));
    }, delayMs);
  }

  private async tick(): Promise<void> {
    const claims = await this.claimBatch();
    if (claims.length === 0) {
      return;
    }

    // `claims` is ordered by occurredAt (see claimDueBatch). Grouping by aggregate and
    // publishing each group sequentially — while letting independent aggregates run
    // concurrently — preserves per-aggregate publish order without serializing the whole
    // batch: two events for the same wallet can never reach SQS out of the order they were
    // created in, but unrelated wallets still publish in parallel.
    const groups = new Map<string, typeof claims>();
    for (const claim of claims) {
      const group = groups.get(claim.aggregateId);
      if (group) {
        group.push(claim);
      } else {
        groups.set(claim.aggregateId, [claim]);
      }
    }

    const outcomeGroups = await Promise.all(
      [...groups.values()].map((group) => this.publishGroupInOrder(group)),
    );

    await this.finalizeBatch(outcomeGroups.flat());
  }

  private async publishGroupInOrder(
    group: Array<{
      id: string;
      aggregateId: string;
      attempts: number;
      body: string;
      occurredAt: Date;
    }>,
  ): Promise<Array<{ id: string; occurredAt: Date; published: boolean }>> {
    const outcomes: Array<{ id: string; occurredAt: Date; published: boolean }> = [];
    let blocked = false;
    for (const claim of group) {
      if (blocked) {
        outcomes.push({ id: claim.id, occurredAt: claim.occurredAt, published: false });
        continue;
      }
      try {
        await this.publisher.publish({
          destination: sqsConfig.eventsQueueUrl,
          partitionKey: claim.aggregateId,
          deduplicationKey: `${claim.id}:${claim.attempts}`,
          body: claim.body,
        });
        outcomes.push({ id: claim.id, occurredAt: claim.occurredAt, published: true });
      } catch (error) {
        this.logger.warn(`failed to publish outbox message ${claim.id}: ${String(error)}`);
        outcomes.push({ id: claim.id, occurredAt: claim.occurredAt, published: false });
        // Don't attempt later messages for this aggregate this tick — publishing them now
        // would deliver out of order relative to the one that just failed.
        blocked = true;
      }
    }
    return outcomes;
  }

  /**
   * Claims a due batch and leases it (see OutboxMessage.claim) in a short transaction, then
   * returns immediately — the row locks from `FOR UPDATE SKIP LOCKED` are released on commit,
   * before this worker ever calls out to SQS. Publishing happens entirely outside any
   * transaction, so a slow/unavailable SQS never holds a Postgres connection or lock open.
   */
  @EnsureRequestContext()
  private async claimBatch(): Promise<
    Array<{ id: string; aggregateId: string; attempts: number; body: string; occurredAt: Date }>
  > {
    return this.orm.em.transactional(async (em) => {
      const now = this.clock.now();
      const repository = em.getRepository<OutboxMessageEntity, OutboxMessageRepository>(
        OutboxMessageEntity,
      );
      const batch = await repository.claimDueBatch(now, outboxConfig.publishBatchSize);

      return batch.map((entity) => {
        const message = OutboxMessageMapper.toDomain(entity);
        message.claim(now, outboxConfig.claimLeaseMs);
        OutboxMessageMapper.applyMutableFields(message, entity);
        em.persist(entity);
        return {
          id: entity.id,
          aggregateId: entity.aggregateId,
          attempts: message.attempts,
          body: JSON.stringify(entity.payload),
          occurredAt: entity.occurredAt,
        };
      });
    });
  }

  @EnsureRequestContext()
  private async finalizeBatch(
    outcomes: Array<{ id: string; occurredAt: Date; published: boolean }>,
  ): Promise<void> {
    await this.orm.em.transactional(async (em) => {
      const now = this.clock.now();
      const repository = em.getRepository<OutboxMessageEntity, OutboxMessageRepository>(
        OutboxMessageEntity,
      );
      const entities = await repository.find({ id: { $in: outcomes.map((o) => o.id) } });
      const entityById = new Map(entities.map((entity) => [entity.id, entity]));

      for (const outcome of outcomes) {
        const entity = entityById.get(outcome.id);
        if (!entity) {
          continue;
        }
        const message = OutboxMessageMapper.toDomain(entity);
        if (outcome.published) {
          message.markPublished(now);
          outboxPublishedTotal.inc();
          outboxLagSeconds.observe((now.getTime() - outcome.occurredAt.getTime()) / 1000);
        } else {
          message.scheduleRetry(now);
          outboxPublishRetriesTotal.inc();
        }
        OutboxMessageMapper.applyMutableFields(message, entity);
        em.persist(entity);
      }
    });
  }
}
