import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { Money } from '../../src/domain/money/money.js';
import { WagerTransactionKind } from '../../src/domain/wagering/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../../src/domain/wagering/wager-transaction-status.js';
import { FailureCode } from '../../src/domain/wagering/failure-code.js';
import { CreateWalletUseCase } from '../../src/application/wallet/create-wallet.use-case.js';
import { SubmitWagerTransactionUseCase } from '../../src/application/wagering/submit-wager-transaction.use-case.js';
import { LedgerDirection } from '../../src/domain/wallet/ledger-direction.js';
import { WalletEntity } from '../../src/infrastructure/persistence/mikro-orm/entities/wallet.entity.js';
import { WalletLedgerEntryEntity } from '../../src/infrastructure/persistence/mikro-orm/entities/wallet-ledger-entry.entity.js';
import { createTestApp } from '../support/test-app.js';

describe('wager concurrency (real parallelism against Postgres)', () => {
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

  it('mandatory scenario: two 80.00 BRL bets on a 100.00 BRL wallet racing — exactly one wins', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerA = `race-${randomUUID()}`;
    const providerB = `race-${randomUUID()}`;

    const [resultA, resultB] = await Promise.all([
      submit.execute({
        providerId: providerA,
        externalTransactionId: 'ext-1',
        idempotencyKey: `${providerA}:ext-1`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: '80.00', currency: 'BRL' }),
      }),
      submit.execute({
        providerId: providerB,
        externalTransactionId: 'ext-1',
        idempotencyKey: `${providerB}:ext-1`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: '80.00', currency: 'BRL' }),
      }),
    ]);

    const statuses = [resultA.status, resultB.status].sort();
    expect(statuses).toEqual([WagerTransactionStatus.Processed, WagerTransactionStatus.Rejected]);

    const rejected = resultA.status === WagerTransactionStatus.Rejected ? resultA : resultB;
    expect(rejected.failureCode).toBe(FailureCode.InsufficientFunds);

    const em = orm.em.fork();
    const finalWallet = await em.getRepository(WalletEntity).findOneOrFail({ id: wallet.id });
    expect(finalWallet.balanceAmount).toBe('20.00');

    const debitCount = await em
      .getRepository(WalletLedgerEntryEntity)
      .count({ walletId: wallet.id, direction: LedgerDirection.Debit });
    expect(debitCount).toBe(1);
  }, 15_000);

  it('sending the same bet 50 times in parallel produces exactly one debit', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '1000.00', currency: 'BRL' }),
    });
    const providerId = `burst-${randomUUID()}`;
    const idempotencyKey = `${providerId}:ext-1`;

    const command = {
      providerId,
      externalTransactionId: 'ext-1',
      idempotencyKey,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '10.00', currency: 'BRL' }),
    };

    const results = await Promise.all(Array.from({ length: 50 }, () => submit.execute(command)));

    const processed = results.filter((r) => !r.idempotentReplay);
    const replays = results.filter((r) => r.idempotentReplay);
    expect(processed.length).toBe(1);
    expect(replays.length).toBe(49);

    const em = orm.em.fork();
    const finalWallet = await em.getRepository(WalletEntity).findOneOrFail({ id: wallet.id });
    expect(finalWallet.balanceAmount).toBe('990.00');

    const debitCount = await em
      .getRepository(WalletLedgerEntryEntity)
      .count({ walletId: wallet.id, direction: LedgerDirection.Debit });
    expect(debitCount).toBe(1);
  }, 20_000);

  it('wallets processed concurrently do not interfere with each other', async () => {
    const [walletA, walletB] = await Promise.all([
      createWallet.execute({
        playerId: randomUUID(),
        initialBalance: Money.from({ amount: '50.00', currency: 'BRL' }),
      }),
      createWallet.execute({
        playerId: randomUUID(),
        initialBalance: Money.from({ amount: '50.00', currency: 'BRL' }),
      }),
    ]);
    const providerId = `parallel-${randomUUID()}`;

    const [resultA, resultB] = await Promise.all([
      submit.execute({
        providerId,
        externalTransactionId: 'ext-a',
        idempotencyKey: `${providerId}:ext-a`,
        playerId: walletA.playerId,
        walletId: walletA.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: '20.00', currency: 'BRL' }),
      }),
      submit.execute({
        providerId,
        externalTransactionId: 'ext-b',
        idempotencyKey: `${providerId}:ext-b`,
        playerId: walletB.playerId,
        walletId: walletB.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: '20.00', currency: 'BRL' }),
      }),
    ]);

    expect(resultA.status).toBe(WagerTransactionStatus.Processed);
    expect(resultB.status).toBe(WagerTransactionStatus.Processed);
    expect(resultA.balance).toEqual({ amount: '30.00', currency: 'BRL' });
    expect(resultB.balance).toEqual({ amount: '30.00', currency: 'BRL' });
  }, 15_000);
});
