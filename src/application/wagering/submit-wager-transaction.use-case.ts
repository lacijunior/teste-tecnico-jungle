import {
  EnsureRequestContext,
  MikroORM,
  UniqueConstraintViolationException,
  type EntityManager,
} from '@mikro-orm/core';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Money, type MoneyProps } from '../../domain/money/money.js';
import { LedgerDirection } from '../../domain/wallet/ledger-direction.js';
import type { Wallet } from '../../domain/wallet/wallet.js';
import { FailureCode } from '../../domain/wagering/failure-code.js';
import { ReferenceResolver } from '../../domain/wagering/reference-resolver.js';
import { WagerTransactionKind } from '../../domain/wagering/wager-transaction-kind.js';
import {
  TERMINAL_STATUSES,
  WagerTransactionStatus,
} from '../../domain/wagering/wager-transaction-status.js';
import { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import {
  mapReferenceErrorToFailureCode,
  mapWalletMutationErrorToFailureCode,
} from '../../domain/wagering/wagering-failure-mapper.js';
import { OutboxMessage } from '../../domain/messaging/outbox-message.js';
import type { IntegrationEvent } from '../../domain/messaging/integration-event.js';
import { WalletBalanceChanged } from '../../domain/messaging/events/wallet-balance-changed.event.js';
import { WagerTransactionProcessed } from '../../domain/messaging/events/wager-transaction-processed.event.js';
import { WagerTransactionRejected } from '../../domain/messaging/events/wager-transaction-rejected.event.js';
import { WagerTransactionPendingReference } from '../../domain/messaging/events/wager-transaction-pending-reference.event.js';
import { WalletEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet.entity.js';
import { WagerTransactionEntity } from '../../infrastructure/persistence/mikro-orm/entities/wager-transaction.entity.js';
import { WalletRepository } from '../../infrastructure/persistence/mikro-orm/repositories/wallet.repository.js';
import { WagerTransactionRepository } from '../../infrastructure/persistence/mikro-orm/repositories/wager-transaction.repository.js';
import { WalletMapper } from '../../infrastructure/persistence/mikro-orm/mappers/wallet.mapper.js';
import { WagerTransactionMapper } from '../../infrastructure/persistence/mikro-orm/mappers/wager-transaction.mapper.js';
import { WalletLedgerEntryMapper } from '../../infrastructure/persistence/mikro-orm/mappers/wallet-ledger-entry.mapper.js';
import { LedgerPostingMapper } from '../../infrastructure/persistence/mikro-orm/mappers/ledger-posting.mapper.js';
import { OutboxMessageMapper } from '../../infrastructure/persistence/mikro-orm/mappers/outbox-message.mapper.js';
import { CLOCK, type Clock } from '../ports/clock.js';
import { ID_GENERATOR, type IdGenerator } from '../ports/id-generator.js';
import { WAGERING_METRICS, type WageringMetrics } from '../ports/wagering-metrics.js';
import { IdempotencyKeyPolicy } from './idempotency-key-policy.js';
import { WagerTransactionLedgerPoster } from './wager-transaction-ledger-poster.js';
import {
  WalletLockRetryExhaustedError,
  WalletLockRetryPolicy,
} from '../wallet/wallet-lock-retry-policy.js';
import {
  ExternalTransactionIdempotencyMismatchError,
  IdempotencyPayloadConflictError,
  WalletNotFoundError,
  WalletOwnershipMismatchError,
} from './wagering-application.errors.js';

export interface SubmitWagerTransactionCommand {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
}

export interface SubmitWagerTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: MoneyProps;
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}

interface EventContext {
  eventId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
}

@Injectable()
export class SubmitWagerTransactionUseCase {
  private readonly logger = new Logger(SubmitWagerTransactionUseCase.name);

  constructor(
    private readonly orm: MikroORM,
    private readonly lockRetryPolicy: WalletLockRetryPolicy,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
    @Inject(WAGERING_METRICS) private readonly metrics: WageringMetrics,
  ) {}

  @EnsureRequestContext()
  public async execute(
    command: SubmitWagerTransactionCommand,
  ): Promise<SubmitWagerTransactionResult> {
    const startedAt = performance.now();
    try {
      const result = await this.lockRetryPolicy
        .run(() => this.orm.em.transactional((em) => this.processWithinTransaction(em, command)))
        .catch(async (error: unknown) => {
          if (error instanceof UniqueConstraintViolationException) {
            return this.resolveConcurrentReplay(command);
          }
          if (error instanceof WalletLockRetryExhaustedError) {
            return this.recordInfrastructureFailure(command, error);
          }
          throw error;
        });
      this.recordOutcome(result);
      return result;
    } finally {
      this.metrics.observeSubmitDurationSeconds((performance.now() - startedAt) / 1000);
    }
  }

  private recordOutcome(result: SubmitWagerTransactionResult): void {
    this.metrics.recordTransactionOutcome(result.status);
    if (result.idempotentReplay) {
      this.metrics.recordIdempotentReplay();
    }
  }

  private hashPayload(command: SubmitWagerTransactionCommand): string {
    return IdempotencyKeyPolicy.hashPayload({
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      playerId: command.playerId,
      walletId: command.walletId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: command.money.toJSON(),
      referenceExternalTransactionId: command.referenceExternalTransactionId,
    });
  }

  private async resolveConcurrentReplay(
    command: SubmitWagerTransactionCommand,
  ): Promise<SubmitWagerTransactionResult> {
    return this.orm.em.transactional(async (em) => {
      const payloadHash = this.hashPayload(command);
      const repository = em.getRepository<WagerTransactionEntity, WagerTransactionRepository>(
        WagerTransactionEntity,
      );
      const byIdempotencyKey = await repository.findByIdempotencyKey(command.idempotencyKey);
      const existingEntity =
        byIdempotencyKey ??
        (await repository.findByProviderAndExternalId(
          command.providerId,
          command.externalTransactionId,
        ));
      if (!existingEntity) {
        throw new Error(
          `unique constraint violation for idempotency key ${command.idempotencyKey} but no row could be found afterwards`,
        );
      }
      // The unique violation came from (providerId, externalTransactionId), not from
      // idempotencyKey itself: this external operation was already recorded under a
      // *different* idempotency key. The key is the declared source of truth (README §9),
      // so this is a genuine conflict, never a silent replay under the wrong key.
      if (!byIdempotencyKey && existingEntity.idempotencyKey !== command.idempotencyKey) {
        throw new ExternalTransactionIdempotencyMismatchError(
          command.providerId,
          command.externalTransactionId,
        );
      }
      return this.buildReplay(existingEntity, payloadHash);
    });
  }

  private async recordInfrastructureFailure(
    command: SubmitWagerTransactionCommand,
    cause: WalletLockRetryExhaustedError,
  ): Promise<SubmitWagerTransactionResult> {
    return this.orm.em.transactional(async (em) => {
      const payloadHash = this.hashPayload(command);
      const transactionRepository = em.getRepository<
        WagerTransactionEntity,
        WagerTransactionRepository
      >(WagerTransactionEntity);

      const existingEntity = await transactionRepository.findByIdempotencyKey(
        command.idempotencyKey,
      );
      if (existingEntity) {
        return this.buildReplay(existingEntity, payloadHash);
      }

      const balance = await this.currentWalletBalance(em, command.walletId);
      const transaction = WagerTransaction.create({
        id: this.idGenerator.next(),
        providerId: command.providerId,
        externalTransactionId: command.externalTransactionId,
        idempotencyKey: command.idempotencyKey,
        payloadHash,
        walletId: command.walletId,
        playerId: command.playerId,
        roundId: command.roundId,
        gameId: command.gameId,
        kind: command.kind,
        money: command.money,
        referenceExternalTransactionId: command.referenceExternalTransactionId,
        createdAt: this.clock.now(),
      });
      transaction.fail(FailureCode.InfrastructureTransientFailure, Money.from(balance));
      this.persistNewTransaction(em, transaction);
      await em.flush();

      this.logger.error(
        `wager transaction ${transaction.id} marked FAILED after exhausting wallet lock retries: ${cause.message}`,
      );

      return {
        transactionId: transaction.id,
        status: transaction.status,
        balance,
        idempotentReplay: false,
        failureCode: FailureCode.InfrastructureTransientFailure,
      };
    });
  }

  private async processWithinTransaction(
    em: EntityManager,
    command: SubmitWagerTransactionCommand,
  ): Promise<SubmitWagerTransactionResult> {
    const transactionRepository = em.getRepository<
      WagerTransactionEntity,
      WagerTransactionRepository
    >(WagerTransactionEntity);
    const payloadHash = this.hashPayload(command);

    const existingEntity = await transactionRepository.findByIdempotencyKey(command.idempotencyKey);
    if (existingEntity) {
      return this.buildReplay(existingEntity, payloadHash);
    }

    const walletEntity = await em
      .getRepository<WalletEntity, WalletRepository>(WalletEntity)
      .findOne({ id: command.walletId });
    if (!walletEntity) {
      throw new WalletNotFoundError(command.walletId);
    }
    if (walletEntity.playerId !== command.playerId) {
      throw new WalletOwnershipMismatchError(command.walletId, command.playerId);
    }

    const wallet = WalletMapper.toDomain(walletEntity);
    const now = this.clock.now();
    const transaction = WagerTransaction.create({
      id: this.idGenerator.next(),
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      idempotencyKey: command.idempotencyKey,
      payloadHash,
      walletId: command.walletId,
      playerId: command.playerId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: command.money,
      referenceExternalTransactionId: command.referenceExternalTransactionId,
      createdAt: now,
    });

    if (transaction.requiresReference()) {
      return this.processReversal(em, transaction, wallet, walletEntity, command, now);
    }

    return this.processDirect(em, transaction, wallet, walletEntity, now);
  }

  private buildReplay(
    existingEntity: WagerTransactionEntity,
    payloadHash: string,
  ): SubmitWagerTransactionResult {
    const existing = WagerTransactionMapper.toDomain(existingEntity);
    if (!existing.matchesPayload(payloadHash)) {
      throw new IdempotencyPayloadConflictError(existing.idempotencyKey);
    }

    if (!existing.balanceSnapshot) {
      throw new Error(`wager transaction ${existing.id} has no balance snapshot recorded`);
    }

    return {
      transactionId: existing.id,
      status: existing.status,
      balance: existing.balanceSnapshot.toJSON(),
      idempotentReplay: true,
      failureCode: existing.failureCode,
    };
  }

  private async currentWalletBalance(em: EntityManager, walletId: string): Promise<MoneyProps> {
    const walletEntity = await em
      .getRepository<WalletEntity, WalletRepository>(WalletEntity)
      .findOne({ id: walletId });
    return walletEntity
      ? { amount: walletEntity.balanceAmount, currency: walletEntity.currency }
      : { amount: '0.00', currency: 'BRL' };
  }

  private async processReversal(
    em: EntityManager,
    transaction: WagerTransaction,
    wallet: Wallet,
    walletEntity: WalletEntity,
    command: SubmitWagerTransactionCommand,
    now: Date,
  ): Promise<SubmitWagerTransactionResult> {
    const transactionRepository = em.getRepository<
      WagerTransactionEntity,
      WagerTransactionRepository
    >(WagerTransactionEntity);
    const referenceEntity = await transactionRepository.findByProviderAndExternalId(
      command.providerId,
      command.referenceExternalTransactionId!,
    );

    if (
      referenceEntity &&
      TERMINAL_STATUSES.has(referenceEntity.status) &&
      referenceEntity.status !== WagerTransactionStatus.Processed
    ) {
      // The reference exists but reached a terminal state other than PROCESSED (e.g. REJECTED
      // or FAILED) — it will never become PROCESSED, so waiting any longer only costs useless
      // reprocessing attempts. Reject now, auditable, instead of letting it ride out
      // PENDING_REFERENCE until the TTL/attempt limit exhausts into REFERENCE_NOT_FOUND.
      transaction.reject(FailureCode.ReferenceNeverProcessed, wallet.balance);
      this.persistNewTransaction(em, transaction);
      this.enqueue(em, WagerTransactionRejected.from(transaction, this.newContext(transaction.id)));
      await em.flush();
      return {
        transactionId: transaction.id,
        status: transaction.status,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
        failureCode: FailureCode.ReferenceNeverProcessed,
      };
    }

    if (!referenceEntity || referenceEntity.status !== WagerTransactionStatus.Processed) {
      transaction.markPendingReference(wallet.balance);
      this.persistNewTransaction(em, transaction);
      this.enqueue(
        em,
        WagerTransactionPendingReference.from(transaction, this.newContext(transaction.id)),
      );
      await em.flush();
      return {
        transactionId: transaction.id,
        status: transaction.status,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    }

    const reference = WagerTransactionMapper.toDomain(referenceEntity);

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
          providerId: command.providerId,
          playerId: command.playerId,
          walletId: command.walletId,
          currency: wallet.currency,
          roundId: command.roundId,
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
      this.persistNewTransaction(em, transaction);
      this.enqueue(em, WagerTransactionRejected.from(transaction, this.newContext(transaction.id)));
      await em.flush();
      return {
        transactionId: transaction.id,
        status: transaction.status,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
        failureCode,
      };
    }

    const direction = transaction.ledgerDirectionFor(reference);
    return this.applyToWallet(
      em,
      transaction,
      wallet,
      walletEntity,
      direction,
      now,
      reference.id,
      true,
    );
  }

  private async processDirect(
    em: EntityManager,
    transaction: WagerTransaction,
    wallet: Wallet,
    walletEntity: WalletEntity,
    now: Date,
  ): Promise<SubmitWagerTransactionResult> {
    if (!transaction.affectsBalance()) {
      transaction.markProcessed(undefined, now, wallet.balance);
      this.persistNewTransaction(em, transaction);
      this.enqueue(
        em,
        WagerTransactionProcessed.from(transaction, this.newContext(transaction.id)),
      );
      await em.flush();
      return {
        transactionId: transaction.id,
        status: transaction.status,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    }

    const direction = transaction.ledgerDirectionFor();
    return this.applyToWallet(
      em,
      transaction,
      wallet,
      walletEntity,
      direction,
      now,
      undefined,
      false,
    );
  }

  private async applyToWallet(
    em: EntityManager,
    transaction: WagerTransaction,
    wallet: Wallet,
    walletEntity: WalletEntity,
    direction: LedgerDirection,
    now: Date,
    referenceTransactionId: string | undefined,
    isReversal: boolean,
  ): Promise<SubmitWagerTransactionResult> {
    try {
      const { ledgerEntry, posting } = WagerTransactionLedgerPoster.post({
        idGenerator: this.idGenerator,
        transaction,
        wallet,
        direction,
        now,
        referenceTransactionId,
      });

      WalletMapper.applyMutation(wallet, walletEntity);
      em.persist(walletEntity);
      em.persist(WagerTransactionMapper.toNewEntity(transaction));
      await em.flush();

      em.persist(WalletLedgerEntryMapper.toNewEntity(ledgerEntry));
      em.persist(LedgerPostingMapper.toNewEntity(posting));

      const processedCtx = this.newContext(transaction.id);
      this.enqueue(em, WagerTransactionProcessed.from(transaction, processedCtx));
      this.enqueue(
        em,
        WalletBalanceChanged.from(wallet, ledgerEntry, {
          ...this.newContext(transaction.id),
          causationId: processedCtx.eventId,
        }),
      );

      await em.flush();

      return {
        transactionId: transaction.id,
        status: transaction.status,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
      };
    } catch (error) {
      const failureCode = mapWalletMutationErrorToFailureCode(error, isReversal);
      if (!failureCode) {
        throw error;
      }
      transaction.reject(failureCode, wallet.balance);
      this.persistNewTransaction(em, transaction);
      this.enqueue(em, WagerTransactionRejected.from(transaction, this.newContext(transaction.id)));
      await em.flush();
      return {
        transactionId: transaction.id,
        status: transaction.status,
        balance: wallet.balance.toJSON(),
        idempotentReplay: false,
        failureCode,
      };
    }
  }

  private persistNewTransaction(em: EntityManager, transaction: WagerTransaction): void {
    em.persist(WagerTransactionMapper.toNewEntity(transaction));
  }

  private enqueue(em: EntityManager, event: IntegrationEvent<unknown>): void {
    const message = OutboxMessage.enqueue(event);
    em.persist(OutboxMessageMapper.toNewEntity(message));
  }

  private newContext(aggregateId: string): EventContext {
    return {
      eventId: this.idGenerator.next(),
      correlationId: aggregateId,
      occurredAt: this.clock.now(),
    };
  }
}
