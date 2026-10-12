import { createHash } from 'node:crypto';
import { EnsureRequestContext, MikroORM } from '@mikro-orm/core';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  type Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { InboxMessage } from '../../../domain/messaging/inbox-message.js';
import { SubmitWagerTransactionUseCase } from '../../../application/wagering/submit-wager-transaction.use-case.js';
import { CLOCK, type Clock } from '../../../application/ports/clock.js';
import { Money } from '../../../domain/money/money.js';
import { InboxMessageEntity } from '../../persistence/mikro-orm/entities/inbox-message.entity.js';
import { InboxMessageRepository } from '../../persistence/mikro-orm/repositories/inbox-message.repository.js';
import { InboxMessageMapper } from '../../persistence/mikro-orm/mappers/inbox-message.mapper.js';
import { sqsConfig } from '../../config/wagering.config.js';
import { SQS_CLIENT } from './sqs.tokens.js';
import { isWagerTransactionRequestedMessage } from './wager-transaction-message.js';
import {
  sqsDuplicatesDetectedTotal,
  sqsMessageFailuresTotal,
} from '../../observability/metrics.js';

export const WAGER_TRANSACTION_CONSUMER_NAME = 'wagering-transactions-consumer';

const POLL_WAIT_TIME_SECONDS = 10;
const POLL_BATCH_SIZE = 5;
const BASE_VISIBILITY_BACKOFF_SECONDS = 5;
const MAX_VISIBILITY_BACKOFF_SECONDS = 15 * 60;

/**
 * A message that will never succeed no matter how many times it is retried — its envelope
 * failed validation. It still only ever leaves the queue via SQS's own redrive policy (the
 * app never deletes-and-republishes to the DLQ itself, see ARCHITECTURE.md), but it is logged
 * and counted separately from a transient infrastructure failure so an operator can tell them
 * apart instead of seeing an undifferentiated stream of "failed to process message".
 */
export class PermanentMessageError extends Error {}

@Injectable()
export class SqsConsumerAdapter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerAdapter.name);
  private stopped = false;
  private loopPromise: Promise<void> = Promise.resolve();
  private readonly inFlight = new Set<Promise<void>>();
  private readonly abortController = new AbortController();

  constructor(
    @Inject(SQS_CLIENT) private readonly client: SQSClient,
    private readonly orm: MikroORM,
    private readonly useCase: SubmitWagerTransactionUseCase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  public onModuleInit(): void {
    if (!sqsConfig.queueUrl) {
      this.logger.warn('SQS_WAGER_QUEUE_URL not configured, consumer disabled');
      return;
    }
    this.loopPromise = this.loop();
  }

  public async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    this.abortController.abort();
    await this.loopPromise;
    await Promise.allSettled([...this.inFlight]);
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        const response = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: sqsConfig.queueUrl,
            MaxNumberOfMessages: POLL_BATCH_SIZE,
            WaitTimeSeconds: POLL_WAIT_TIME_SECONDS,
            MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          }),
          { abortSignal: this.abortController.signal },
        );
        // Messages in one batch belong to distinct SQS FIFO message groups — a FIFO queue
        // never hands out two unacked messages from the same group at once — so processing
        // the batch concurrently cannot reorder operations within a group, only across
        // independent ones, which the system already tolerates by design.
        const tasks = (response.Messages ?? []).map((message) => {
          const task = this.handle(message).finally(() => this.inFlight.delete(task));
          this.inFlight.add(task);
          return task;
        });
        await Promise.all(tasks);
      } catch (error) {
        if (!this.stopped) {
          this.logger.error('failed to poll SQS queue', error);
        }
      }
    }
  }

  private async handle(message: Message): Promise<void> {
    if (!message.Body || !message.ReceiptHandle || !message.MessageId) {
      this.logger.warn('discarding malformed SQS message without body/receipt handle');
      return;
    }

    try {
      await this.processWithinTransaction(message.MessageId, message.Body);
      await this.client.send(
        new DeleteMessageCommand({
          QueueUrl: sqsConfig.queueUrl,
          ReceiptHandle: message.ReceiptHandle,
        }),
      );
    } catch (error) {
      if (error instanceof PermanentMessageError) {
        sqsMessageFailuresTotal.inc({ kind: 'permanent' });
        this.logger.error(
          `permanent failure processing message ${message.MessageId}, will exhaust retries into the DLQ: ${error.message}`,
        );
      } else {
        sqsMessageFailuresTotal.inc({ kind: 'transient' });
        this.logger.error(`transient failure processing message ${message.MessageId}`, error);
      }
      await this.backoffVisibility(message);
    }
  }

  @EnsureRequestContext()
  private async processWithinTransaction(messageId: string, body: string): Promise<void> {
    await this.orm.em.transactional(async (em) => {
      const inboxRepository = em.getRepository<InboxMessageEntity, InboxMessageRepository>(
        InboxMessageEntity,
      );
      const existing = await inboxRepository.findByConsumerAndMessage(
        WAGER_TRANSACTION_CONSUMER_NAME,
        messageId,
      );
      if (existing?.processedAt) {
        sqsDuplicatesDetectedTotal.inc();
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new PermanentMessageError(`message ${messageId} is not valid JSON`);
      }
      if (!isWagerTransactionRequestedMessage(parsed)) {
        throw new PermanentMessageError(
          `message ${messageId} does not match the expected envelope`,
        );
      }

      const now = this.clock.now();
      const payloadHash = createHash('sha256').update(body).digest('hex');
      const inboxEntity =
        existing ??
        InboxMessageMapper.toNewEntity(
          InboxMessage.receive({
            messageId,
            consumerName: WAGER_TRANSACTION_CONSUMER_NAME,
            payloadHash,
            receivedAt: now,
          }),
        );

      await this.useCase.execute({
        providerId: parsed.data.providerId,
        externalTransactionId: parsed.data.externalTransactionId,
        idempotencyKey: parsed.data.idempotencyKey,
        playerId: parsed.data.playerId,
        walletId: parsed.data.walletId,
        roundId: parsed.data.roundId,
        gameId: parsed.data.gameId,
        kind: parsed.data.kind,
        money: Money.from(parsed.data.money),
        referenceExternalTransactionId: parsed.data.referenceExternalTransactionId,
      });

      const inboxMessage = InboxMessage.rehydrate({
        messageId,
        consumerName: WAGER_TRANSACTION_CONSUMER_NAME,
        payloadHash,
        receivedAt: inboxEntity.receivedAt,
        processedAt: undefined,
      });
      inboxMessage.markProcessed(this.clock.now());
      InboxMessageMapper.applyMutableFields(inboxMessage, inboxEntity);
      em.persist(inboxEntity);
    });
  }

  private async backoffVisibility(message: Message): Promise<void> {
    if (!message.ReceiptHandle) {
      return;
    }
    const receiveCount = Number.parseInt(message.Attributes?.ApproximateReceiveCount ?? '1', 10);
    const delaySeconds = Math.min(
      BASE_VISIBILITY_BACKOFF_SECONDS * 2 ** Math.max(receiveCount - 1, 0),
      MAX_VISIBILITY_BACKOFF_SECONDS,
    );
    try {
      await this.client.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: sqsConfig.queueUrl,
          ReceiptHandle: message.ReceiptHandle,
          VisibilityTimeout: delaySeconds,
        }),
      );
    } catch (error) {
      this.logger.warn(`failed to change message visibility for ${message.MessageId}`, error);
    }
  }
}
