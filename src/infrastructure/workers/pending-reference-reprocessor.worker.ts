import { EnsureRequestContext, MikroORM, type EntityManager } from '@mikro-orm/core';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ReferenceResolver } from '../../domain/wagering/reference-resolver.js';
import { WagerTransactionKind } from '../../domain/wagering/wager-transaction-kind.js';
import {
  TERMINAL_STATUSES,
  WagerTransactionStatus,
} from '../../domain/wagering/wager-transaction-status.js';
import type { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import { FailureCode } from '../../domain/wagering/failure-code.js';
import {
  mapReferenceErrorToFailureCode,
  mapWalletMutationErrorToFailureCode,
} from '../../domain/wagering/wagering-failure-mapper.js';
import { WagerTransactionProcessed } from '../../domain/messaging/events/wager-transaction-processed.event.js';
import { WagerTransactionRejected } from '../../domain/messaging/events/wager-transaction-rejected.event.js';
import { WalletBalanceChanged } from '../../domain/messaging/events/wallet-balance-changed.event.js';
import { OutboxMessage } from '../../domain/messaging/outbox-message.js';
import type { IntegrationEvent } from '../../domain/messaging/integration-event.js';
import { CLOCK, type Clock } from '../../application/ports/clock.js';
import { ID_GENERATOR, type IdGenerator } from '../../application/ports/id-generator.js';
import { WagerTransactionLedgerPoster } from '../../application/wagering/wager-transaction-ledger-poster.js';
import { WalletEntity } from '../persistence/mikro-orm/entities/wallet.entity.js';
import { WagerTransactionEntity } from '../persistence/mikro-orm/entities/wager-transaction.entity.js';
import { WalletRepository } from '../persistence/mikro-orm/repositories/wallet.repository.js';
import { WagerTransactionRepository } from '../persistence/mikro-orm/repositories/wager-transaction.repository.js';
import { WalletMapper } from '../persistence/mikro-orm/mappers/wallet.mapper.js';
import { WagerTransactionMapper } from '../persistence/mikro-orm/mappers/wager-transaction.mapper.js';
import { WalletLedgerEntryMapper } from '../persistence/mikro-orm/mappers/wallet-ledger-entry.mapper.js';
import { LedgerPostingMapper } from '../persistence/mikro-orm/mappers/ledger-posting.mapper.js';
import { OutboxMessageMapper } from '../persistence/mikro-orm/mappers/outbox-message.mapper.js';
import { pendingReferenceConfig } from '../config/wagering.config.js';

const BASE_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1_000;

@Injectable()
export class PendingReferenceReprocessorWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingReferenceReprocessorWorker.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private runningTick: Promise<void> = Promise.resolve();

  constructor(
    private readonly orm: MikroORM,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
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
        .catch((error: unknown) =>
          this.logger.error('pending reference reprocessor tick failed', error),
        )
        .finally(() => this.scheduleNext(pendingReferenceConfig.pollIntervalMs));
    }, delayMs);
  }

  @EnsureRequestContext()
  private async tick(): Promise<void> {
    const now = this.clock.now();
    const due = await this.orm.em
      .getRepository<WagerTransactionEntity, WagerTransactionRepository>(WagerTransactionEntity)
      .findDuePendingReferences(now, 50);

    for (const entity of due) {
      try {
        await this.reprocessOne(entity.id);
      } catch (error) {
        this.logger.error(`failed to reprocess pending reference ${entity.id}`, error);
      }
    }
  }

  @EnsureRequestContext()
  private async reprocessOne(transactionId: string): Promise<void> {
    await this.orm.em.transactional(async (em) => {
      const transactionRepository = em.getRepository<
        WagerTransactionEntity,
        WagerTransactionRepository
      >(WagerTransactionEntity);
      const entity = await transactionRepository.findOne({ id: transactionId });
      if (!entity || entity.status !== WagerTransactionStatus.PendingReference) {
        return;
      }

      const transaction = WagerTransactionMapper.toDomain(entity);
      const now = this.clock.now();
      const referenceEntity = await transactionRepository.findByProviderAndExternalId(
        transaction.providerId,
        transaction.referenceExternalTransactionId!,
      );

      if (
        referenceEntity &&
        TERMINAL_STATUSES.has(referenceEntity.status) &&
        referenceEntity.status !== WagerTransactionStatus.Processed
      ) {
        // Terminal but never PROCESSED (e.g. REJECTED/FAILED) — it will never resolve, so
        // reject now instead of burning further reprocessing attempts toward REFERENCE_NOT_FOUND.
        transaction.reject(FailureCode.ReferenceNeverProcessed, transaction.balanceSnapshot!);
        WagerTransactionMapper.applyMutableFields(transaction, entity);
        em.persist(entity);
        this.enqueue(
          em,
          WagerTransactionRejected.from(transaction, this.newContext(transaction.id, now)),
        );
        return;
      }

      if (!referenceEntity || referenceEntity.status !== WagerTransactionStatus.Processed) {
        this.handleStillUnresolved(em, transaction, entity, now);
        return;
      }

      const reference = WagerTransactionMapper.toDomain(referenceEntity);
      const walletEntity = await em
        .getRepository<WalletEntity, WalletRepository>(WalletEntity)
        .findOne({ id: transaction.walletId });
      if (!walletEntity) {
        this.logger.error(
          `wallet ${transaction.walletId} missing for pending transaction ${transaction.id}`,
        );
        return;
      }
      const wallet = WalletMapper.toDomain(walletEntity);

      try {
        const alreadyReversedEntity = await transactionRepository.findProcessedReversalByReference(
          transaction.kind,
          reference.id,
        );
        ReferenceResolver.ensureValid({
          reversingKind: transaction.kind as
            WagerTransactionKind.Refund | WagerTransactionKind.Rollback,
          reference,
          scope: {
            providerId: transaction.providerId,
            playerId: transaction.playerId,
            walletId: transaction.walletId,
            currency: wallet.currency,
            roundId: transaction.roundId,
          },
          expectedMoney: transaction.money,
          alreadyReversed: alreadyReversedEntity !== null,
        });
      } catch (error) {
        const failureCode = mapReferenceErrorToFailureCode(error);
        if (!failureCode) {
          throw error;
        }
        transaction.reject(failureCode, wallet.balance);
        WagerTransactionMapper.applyMutableFields(transaction, entity);
        em.persist(entity);
        this.enqueue(
          em,
          WagerTransactionRejected.from(transaction, this.newContext(transaction.id, now)),
        );
        return;
      }

      const direction = transaction.ledgerDirectionFor(reference);
      try {
        const { ledgerEntry, posting } = WagerTransactionLedgerPoster.post({
          idGenerator: this.idGenerator,
          transaction,
          wallet,
          direction,
          now,
          referenceTransactionId: reference.id,
        });

        WalletMapper.applyMutation(wallet, walletEntity);
        WagerTransactionMapper.applyMutableFields(transaction, entity);
        em.persist(walletEntity);
        em.persist(entity);
        em.persist(WalletLedgerEntryMapper.toNewEntity(ledgerEntry));
        em.persist(LedgerPostingMapper.toNewEntity(posting));

        const processedCtx = this.newContext(transaction.id, now);
        this.enqueue(em, WagerTransactionProcessed.from(transaction, processedCtx));
        this.enqueue(
          em,
          WalletBalanceChanged.from(wallet, ledgerEntry, {
            ...this.newContext(transaction.id, now),
            causationId: processedCtx.eventId,
          }),
        );
      } catch (error) {
        const failureCode = mapWalletMutationErrorToFailureCode(error, true);
        if (!failureCode) {
          throw error;
        }
        transaction.reject(failureCode, wallet.balance);
        WagerTransactionMapper.applyMutableFields(transaction, entity);
        em.persist(entity);
        this.enqueue(
          em,
          WagerTransactionRejected.from(transaction, this.newContext(transaction.id, now)),
        );
      }
    });
  }

  private handleStillUnresolved(
    em: EntityManager,
    transaction: WagerTransaction,
    entity: WagerTransactionEntity,
    now: Date,
  ): void {
    const ageMs = now.getTime() - transaction.createdAt.getTime();
    const ttlMs = pendingReferenceConfig.ttlHours * 60 * 60 * 1_000;
    const exhausted =
      transaction.pendingReferenceAttempts + 1 >= pendingReferenceConfig.maxAttempts ||
      ageMs >= ttlMs;

    if (exhausted) {
      transaction.reject(FailureCode.ReferenceNotFound, transaction.balanceSnapshot!);
      WagerTransactionMapper.applyMutableFields(transaction, entity);
      em.persist(entity);
      this.enqueue(
        em,
        WagerTransactionRejected.from(transaction, this.newContext(transaction.id, now)),
      );
      return;
    }

    const delay = Math.min(
      BASE_RETRY_DELAY_MS * 2 ** transaction.pendingReferenceAttempts,
      MAX_RETRY_DELAY_MS,
    );
    transaction.scheduleReferenceRetry(new Date(now.getTime() + delay));
    WagerTransactionMapper.applyMutableFields(transaction, entity);
    em.persist(entity);
  }

  private enqueue(em: EntityManager, event: IntegrationEvent<unknown>): void {
    const message = OutboxMessage.enqueue(event);
    em.persist(OutboxMessageMapper.toNewEntity(message));
  }

  private newContext(
    aggregateId: string,
    now: Date,
  ): { eventId: string; correlationId: string; occurredAt: Date } {
    return { eventId: this.idGenerator.next(), correlationId: aggregateId, occurredAt: now };
  }
}
