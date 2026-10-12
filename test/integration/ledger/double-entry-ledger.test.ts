import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { MikroORM } from '@mikro-orm/core';
import { Money } from '../../../src/domain/money/money.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';
import { LedgerAccountType } from '../../../src/domain/ledger/ledger-account.js';
import { CreateWalletUseCase } from '../../../src/application/wallet/create-wallet.use-case.js';
import { SubmitWagerTransactionUseCase } from '../../../src/application/wagering/submit-wager-transaction.use-case.js';
import { WalletEntity } from '../../../src/infrastructure/persistence/mikro-orm/entities/wallet.entity.js';
import { LedgerPostingEntity } from '../../../src/infrastructure/persistence/mikro-orm/entities/ledger-posting.entity.js';
import type { LedgerPostingRepository } from '../../../src/infrastructure/persistence/mikro-orm/repositories/ledger-posting.repository.js';
import { createTestApp } from '../../support/test-app.js';

describe('double-entry ledger postings (integration)', () => {
  let app: INestApplicationContext;
  let createWallet: CreateWalletUseCase;
  let submit: SubmitWagerTransactionUseCase;
  let orm: MikroORM;

  beforeAll(async () => {
    app = await createTestApp();
    createWallet = app.get(CreateWalletUseCase);
    submit = app.get(SubmitWagerTransactionUseCase);
    orm = app.get(MikroORM);
  });

  afterAll(async () => {
    await app.close();
  });

  it('posts a balanced debit/credit pair for OPENING, BET and REFUND, netting to the final balance', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = `double-entry-${randomUUID()}`;

    const bet = await submit.execute({
      providerId,
      externalTransactionId: 'ext-bet-1',
      idempotencyKey: `${providerId}:ext-bet-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '30.00', currency: 'BRL' }),
    });

    await submit.execute({
      providerId,
      externalTransactionId: 'ext-refund-1',
      idempotencyKey: `${providerId}:ext-refund-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: '30.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-bet-1',
    });

    const em = orm.em.fork();
    const walletEntity = await em.getRepository(WalletEntity).findOneOrFail({ id: wallet.id });
    expect(walletEntity.balanceAmount).toBe('100.00');

    const postingRepository = em.getRepository<LedgerPostingEntity, LedgerPostingRepository>(
      LedgerPostingEntity,
    );
    const { debits, credits } = await postingRepository.sumByAccount(
      LedgerAccountType.PlayerWallet,
      wallet.id,
    );

    expect(new Decimal(credits).minus(debits).toFixed(2)).toBe(walletEntity.balanceAmount);

    const betPosting = await postingRepository.findByTransaction(bet.transactionId);
    expect(betPosting?.debitAccountType).toBe(LedgerAccountType.PlayerWallet);
    expect(betPosting?.debitAccountReferenceId).toBe(wallet.id);
    expect(betPosting?.creditAccountType).toBe(LedgerAccountType.ProviderSettlement);
    expect(betPosting?.creditAccountReferenceId).toBe(providerId);
  });

  it('records a single balanced posting for the OPENING credit', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '250.00', currency: 'BRL' }),
    });

    const em = orm.em.fork();
    const postingRepository = em.getRepository<LedgerPostingEntity, LedgerPostingRepository>(
      LedgerPostingEntity,
    );
    const { debits, credits } = await postingRepository.sumByAccount(
      LedgerAccountType.PlayerWallet,
      wallet.id,
    );

    expect(credits).toBe('250.00');
    expect(debits).toBe('0.00');
  });
});
