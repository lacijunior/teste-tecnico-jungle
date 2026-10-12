import { EnsureRequestContext, MikroORM, type EntityManager } from '@mikro-orm/core';
import { Inject, Injectable } from '@nestjs/common';
import { Money, type MoneyProps } from '../../domain/money/money.js';
import { LedgerDirection } from '../../domain/wallet/ledger-direction.js';
import { Wallet } from '../../domain/wallet/wallet.js';
import { WalletLedgerEntry } from '../../domain/wallet/wallet-ledger-entry.js';
import { DoubleEntryPosting } from '../../domain/ledger/double-entry-posting.js';
import { WagerTransactionKind } from '../../domain/wagering/wager-transaction-kind.js';
import { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import { OutboxMessage } from '../../domain/messaging/outbox-message.js';
import type { IntegrationEvent } from '../../domain/messaging/integration-event.js';
import { WalletBalanceChanged } from '../../domain/messaging/events/wallet-balance-changed.event.js';
import { WagerTransactionProcessed } from '../../domain/messaging/events/wager-transaction-processed.event.js';
import { WalletEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet.entity.js';
import { WalletRepository } from '../../infrastructure/persistence/mikro-orm/repositories/wallet.repository.js';
import { WalletMapper } from '../../infrastructure/persistence/mikro-orm/mappers/wallet.mapper.js';
import { WagerTransactionMapper } from '../../infrastructure/persistence/mikro-orm/mappers/wager-transaction.mapper.js';
import { WalletLedgerEntryMapper } from '../../infrastructure/persistence/mikro-orm/mappers/wallet-ledger-entry.mapper.js';
import { LedgerPostingMapper } from '../../infrastructure/persistence/mikro-orm/mappers/ledger-posting.mapper.js';
import { OutboxMessageMapper } from '../../infrastructure/persistence/mikro-orm/mappers/outbox-message.mapper.js';
import { CLOCK, type Clock } from '../ports/clock.js';
import { ID_GENERATOR, type IdGenerator } from '../ports/id-generator.js';
import { IdempotencyKeyPolicy } from '../wagering/idempotency-key-policy.js';
import { WalletAlreadyExistsError } from './wallet-application.errors.js';

export interface CreateWalletCommand {
  playerId: string;
  initialBalance: Money;
}

export interface CreateWalletResult {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

@Injectable()
export class CreateWalletUseCase {
  constructor(
    private readonly orm: MikroORM,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGenerator,
  ) {}

  @EnsureRequestContext()
  public async execute(command: CreateWalletCommand): Promise<CreateWalletResult> {
    return this.orm.em.transactional(async (em) => {
      const walletRepository = em.getRepository<WalletEntity, WalletRepository>(WalletEntity);
      const existing = await walletRepository.findByPlayerAndCurrency(
        command.playerId,
        command.initialBalance.currency,
      );
      if (existing) {
        throw new WalletAlreadyExistsError(command.playerId, command.initialBalance.currency);
      }

      const now = this.clock.now();
      const wallet = Wallet.open({
        id: this.idGenerator.next(),
        playerId: command.playerId,
        initialBalance: command.initialBalance,
        now,
      });
      em.persist(WalletMapper.toNewEntity(wallet));
      await em.flush();

      if (command.initialBalance.isPositive()) {
        await this.openWithCredit(em, wallet, command.initialBalance, now);
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
  }

  private async openWithCredit(
    em: EntityManager,
    wallet: Wallet,
    initialBalance: Money,
    now: Date,
  ): Promise<void> {
    const openingTransaction = WagerTransaction.create({
      id: this.idGenerator.next(),
      providerId: 'internal',
      externalTransactionId: wallet.id,
      idempotencyKey: `internal:opening:${wallet.id}`,
      payloadHash: IdempotencyKeyPolicy.hashPayload({
        providerId: 'internal',
        externalTransactionId: wallet.id,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'opening',
        gameId: 'opening',
        kind: WagerTransactionKind.Opening,
        money: initialBalance.toJSON(),
      }),
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: 'opening',
      gameId: 'opening',
      kind: WagerTransactionKind.Opening,
      money: initialBalance,
      createdAt: now,
    });
    openingTransaction.markProcessed(undefined, now, initialBalance);

    const ledgerEntry = WalletLedgerEntry.create({
      id: this.idGenerator.next(),
      walletId: wallet.id,
      transactionId: openingTransaction.id,
      direction: LedgerDirection.Credit,
      money: initialBalance,
      balanceBefore: Money.zero(initialBalance.currency),
      balanceAfter: initialBalance,
      createdAt: now,
    });

    em.persist(WagerTransactionMapper.toNewEntity(openingTransaction));
    await em.flush();
    em.persist(WalletLedgerEntryMapper.toNewEntity(ledgerEntry));

    const posting = DoubleEntryPosting.forWalletMovement({
      id: this.idGenerator.next(),
      transactionId: openingTransaction.id,
      walletId: wallet.id,
      providerId: openingTransaction.providerId,
      direction: LedgerDirection.Credit,
      money: initialBalance,
      createdAt: now,
    });
    em.persist(LedgerPostingMapper.toNewEntity(posting));

    const processedCtx = {
      eventId: this.idGenerator.next(),
      correlationId: openingTransaction.id,
      occurredAt: now,
    };
    this.enqueue(em, WagerTransactionProcessed.from(openingTransaction, processedCtx));
    this.enqueue(
      em,
      WalletBalanceChanged.from(wallet, ledgerEntry, {
        eventId: this.idGenerator.next(),
        correlationId: openingTransaction.id,
        causationId: processedCtx.eventId,
        occurredAt: now,
      }),
    );
  }

  private enqueue(em: EntityManager, event: IntegrationEvent<unknown>): void {
    const message = OutboxMessage.enqueue(event);
    em.persist(OutboxMessageMapper.toNewEntity(message));
  }
}
