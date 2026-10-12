import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { Money } from '../../../src/domain/money/money.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../../../src/domain/wagering/wager-transaction-status.js';
import { FailureCode } from '../../../src/domain/wagering/failure-code.js';
import { CreateWalletUseCase } from '../../../src/application/wallet/create-wallet.use-case.js';
import { SubmitWagerTransactionUseCase } from '../../../src/application/wagering/submit-wager-transaction.use-case.js';
import { WagerTransactionEntity } from '../../../src/infrastructure/persistence/mikro-orm/entities/wager-transaction.entity.js';
import { WalletEntity } from '../../../src/infrastructure/persistence/mikro-orm/entities/wallet.entity.js';
import { createFullTestApp } from '../../support/test-app.js';
import { waitFor } from '../../support/wait-for.js';

describe('PendingReferenceReprocessorWorker (integration)', () => {
  let app: INestApplicationContext;
  let createWallet: CreateWalletUseCase;
  let submit: SubmitWagerTransactionUseCase;
  let orm: MikroORM;

  beforeAll(async () => {
    app = await createFullTestApp();
    createWallet = app.get(CreateWalletUseCase);
    submit = app.get(SubmitWagerTransactionUseCase);
    orm = app.get(MikroORM);
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves a REFUND that arrived before its BET once the BET is processed', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = `pending-${randomUUID()}`;

    const refundResult = await submit.execute({
      providerId,
      externalTransactionId: 'ext-refund-1',
      idempotencyKey: `${providerId}:ext-refund-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-bet-1',
    });
    expect(refundResult.status).toBe(WagerTransactionStatus.PendingReference);

    await submit.execute({
      providerId,
      externalTransactionId: 'ext-bet-1',
      idempotencyKey: `${providerId}:ext-bet-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
    });

    await waitFor(
      async () => {
        const em = orm.em.fork();
        const entity = await em
          .getRepository(WagerTransactionEntity)
          .findOne({ id: refundResult.transactionId });
        return entity?.status === WagerTransactionStatus.Processed;
      },
      // The worker's very first tick can fire before this BET commits (it schedules
      // immediately on module init), which schedules a BASE_RETRY_DELAY_MS (2s) backoff
      // before the next attempt actually sees the resolved reference — the default 5s
      // waitFor window is too tight against that worst case.
      { timeoutMs: 10_000 },
    );

    const em = orm.em.fork();
    const walletEntity = await em.getRepository(WalletEntity).findOne({ id: wallet.id });
    expect(walletEntity?.balanceAmount).toBe('100.00');
  }, 15_000);

  it('rejects a REFUND whose reference never arrives once attempts are exhausted', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = `pending-${randomUUID()}`;

    const refundResult = await submit.execute({
      providerId,
      externalTransactionId: 'ext-refund-never',
      idempotencyKey: `${providerId}:ext-refund-never`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-bet-never',
    });
    expect(refundResult.status).toBe(WagerTransactionStatus.PendingReference);

    await waitFor(
      async () => {
        const em = orm.em.fork();
        const entity = await em
          .getRepository(WagerTransactionEntity)
          .findOne({ id: refundResult.transactionId });
        return entity?.status === WagerTransactionStatus.Rejected;
      },
      { timeoutMs: 15_000 },
    );

    const em = orm.em.fork();
    const entity = await em
      .getRepository(WagerTransactionEntity)
      .findOne({ id: refundResult.transactionId });
    expect(entity?.failureCode).toBe(FailureCode.ReferenceNotFound);
  }, 20_000);

  it('rejects a REFUND once its reference arrives but is REJECTED, instead of waiting it out to exhaustion', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '5.00', currency: 'BRL' }),
    });
    const providerId = `pending-terminal-${randomUUID()}`;

    const refundResult = await submit.execute({
      providerId,
      externalTransactionId: 'ext-refund-terminal',
      idempotencyKey: `${providerId}:ext-refund-terminal`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: '50.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-bet-insufficient',
    });
    expect(refundResult.status).toBe(WagerTransactionStatus.PendingReference);

    const betResult = await submit.execute({
      providerId,
      externalTransactionId: 'ext-bet-insufficient',
      idempotencyKey: `${providerId}:ext-bet-insufficient`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '50.00', currency: 'BRL' }),
    });
    expect(betResult.status).toBe(WagerTransactionStatus.Rejected);

    await waitFor(
      async () => {
        const em = orm.em.fork();
        const entity = await em
          .getRepository(WagerTransactionEntity)
          .findOne({ id: refundResult.transactionId });
        return entity?.status === WagerTransactionStatus.Rejected;
      },
      { timeoutMs: 10_000 },
    );

    const em = orm.em.fork();
    const entity = await em
      .getRepository(WagerTransactionEntity)
      .findOne({ id: refundResult.transactionId });
    expect(entity?.failureCode).toBe(FailureCode.ReferenceNeverProcessed);
    expect(entity?.pendingReferenceAttempts).toBe(0);
  }, 15_000);
});
