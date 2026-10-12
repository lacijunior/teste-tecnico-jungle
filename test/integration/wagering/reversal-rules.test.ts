import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Money } from '../../../src/domain/money/money.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../../../src/domain/wagering/wager-transaction-status.js';
import { FailureCode } from '../../../src/domain/wagering/failure-code.js';
import { CreateWalletUseCase } from '../../../src/application/wallet/create-wallet.use-case.js';
import { SubmitWagerTransactionUseCase } from '../../../src/application/wagering/submit-wager-transaction.use-case.js';
import { createTestApp } from '../../support/test-app.js';

function uniqueProvider(): string {
  return `reversal-${randomUUID()}`;
}

describe('WIN, LOSS and reversal rules (integration)', () => {
  let app: INestApplicationContext;
  let createWallet: CreateWalletUseCase;
  let submit: SubmitWagerTransactionUseCase;

  beforeAll(async () => {
    app = await createTestApp();
    createWallet = app.get(CreateWalletUseCase);
    submit = app.get(SubmitWagerTransactionUseCase);
  });

  afterAll(async () => {
    await app.close();
  });

  it('credits the wallet on WIN', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    const result = await submit.execute({
      providerId,
      externalTransactionId: 'ext-win-1',
      idempotencyKey: `${providerId}:ext-win-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Win,
      money: Money.from({ amount: '50.00', currency: 'BRL' }),
    });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toEqual({ amount: '150.00', currency: 'BRL' });
  });

  it('does not move the balance on LOSS but still records a PROCESSED transaction', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    const result = await submit.execute({
      providerId,
      externalTransactionId: 'ext-loss-1',
      idempotencyKey: `${providerId}:ext-loss-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Loss,
      money: Money.from({ amount: '15.00', currency: 'BRL' }),
    });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toEqual({ amount: '100.00', currency: 'BRL' });
  });

  it('ROLLBACK of a BET credits the amount back', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    await submit.execute({
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

    const rollback = await submit.execute({
      providerId,
      externalTransactionId: 'ext-rollback-1',
      idempotencyKey: `${providerId}:ext-rollback-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Rollback,
      money: Money.from({ amount: '30.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-bet-1',
    });

    expect(rollback.status).toBe(WagerTransactionStatus.Processed);
    expect(rollback.balance).toEqual({ amount: '100.00', currency: 'BRL' });
  });

  it('ROLLBACK of a WIN debits the amount back', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    await submit.execute({
      providerId,
      externalTransactionId: 'ext-win-1',
      idempotencyKey: `${providerId}:ext-win-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Win,
      money: Money.from({ amount: '40.00', currency: 'BRL' }),
    });

    const rollback = await submit.execute({
      providerId,
      externalTransactionId: 'ext-rollback-1',
      idempotencyKey: `${providerId}:ext-rollback-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Rollback,
      money: Money.from({ amount: '40.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-win-1',
    });

    expect(rollback.status).toBe(WagerTransactionStatus.Processed);
    expect(rollback.balance).toEqual({ amount: '100.00', currency: 'BRL' });
  });

  it('rejects a REFUND referencing a transaction from a different round (scope mismatch)', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    await submit.execute({
      providerId,
      externalTransactionId: 'ext-bet-1',
      idempotencyKey: `${providerId}:ext-bet-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-A',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '20.00', currency: 'BRL' }),
    });

    const refund = await submit.execute({
      providerId,
      externalTransactionId: 'ext-refund-1',
      idempotencyKey: `${providerId}:ext-refund-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-B',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: '20.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-bet-1',
    });

    expect(refund.status).toBe(WagerTransactionStatus.Rejected);
    expect(refund.failureCode).toBe(FailureCode.ReferenceScopeMismatch);
  });

  it('rejects a REFUND whose amount does not match the referenced BET', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    await submit.execute({
      providerId,
      externalTransactionId: 'ext-bet-1',
      idempotencyKey: `${providerId}:ext-bet-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '20.00', currency: 'BRL' }),
    });

    const refund = await submit.execute({
      providerId,
      externalTransactionId: 'ext-refund-1',
      idempotencyKey: `${providerId}:ext-refund-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: '15.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-bet-1',
    });

    expect(refund.status).toBe(WagerTransactionStatus.Rejected);
    expect(refund.failureCode).toBe(FailureCode.ReferenceAmountMismatch);
  });

  it('rejects a second REFUND against a BET that was already refunded', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    await submit.execute({
      providerId,
      externalTransactionId: 'ext-bet-1',
      idempotencyKey: `${providerId}:ext-bet-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '20.00', currency: 'BRL' }),
    });

    const firstRefund = await submit.execute({
      providerId,
      externalTransactionId: 'ext-refund-1',
      idempotencyKey: `${providerId}:ext-refund-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: '20.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-bet-1',
    });
    expect(firstRefund.status).toBe(WagerTransactionStatus.Processed);

    const secondRefund = await submit.execute({
      providerId,
      externalTransactionId: 'ext-refund-2',
      idempotencyKey: `${providerId}:ext-refund-2`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: '20.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-bet-1',
    });

    expect(secondRefund.status).toBe(WagerTransactionStatus.Rejected);
    expect(secondRefund.failureCode).toBe(FailureCode.ReferenceAlreadyReversed);
  });

  it('rejects a REFUND referencing a WIN (only BET is a valid reference for REFUND)', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    await submit.execute({
      providerId,
      externalTransactionId: 'ext-win-1',
      idempotencyKey: `${providerId}:ext-win-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Win,
      money: Money.from({ amount: '20.00', currency: 'BRL' }),
    });

    const refund = await submit.execute({
      providerId,
      externalTransactionId: 'ext-refund-1',
      idempotencyKey: `${providerId}:ext-refund-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: '20.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-win-1',
    });

    expect(refund.status).toBe(WagerTransactionStatus.Rejected);
    expect(refund.failureCode).toBe(FailureCode.ReferenceTypeInvalid);
  });

  it('rejects a ROLLBACK that would push the balance negative with a distinct failure code', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '10.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    await submit.execute({
      providerId,
      externalTransactionId: 'ext-win-1',
      idempotencyKey: `${providerId}:ext-win-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Win,
      money: Money.from({ amount: '20.00', currency: 'BRL' }),
    });

    await submit.execute({
      providerId,
      externalTransactionId: 'ext-bet-2',
      idempotencyKey: `${providerId}:ext-bet-2`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
    });

    const rollback = await submit.execute({
      providerId,
      externalTransactionId: 'ext-rollback-1',
      idempotencyKey: `${providerId}:ext-rollback-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Rollback,
      money: Money.from({ amount: '20.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-win-1',
    });

    expect(rollback.status).toBe(WagerTransactionStatus.Rejected);
    expect(rollback.failureCode).toBe(FailureCode.NegativeBalanceOnReversal);
  });
});
