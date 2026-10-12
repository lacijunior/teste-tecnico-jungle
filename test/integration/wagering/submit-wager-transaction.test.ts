import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Money } from '../../../src/domain/money/money.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../../../src/domain/wagering/wager-transaction-status.js';
import { FailureCode } from '../../../src/domain/wagering/failure-code.js';
import { CreateWalletUseCase } from '../../../src/application/wallet/create-wallet.use-case.js';
import {
  ExternalTransactionIdempotencyMismatchError,
  IdempotencyPayloadConflictError,
  WalletNotFoundError,
  WalletOwnershipMismatchError,
} from '../../../src/application/wagering/wagering-application.errors.js';
import { SubmitWagerTransactionUseCase } from '../../../src/application/wagering/submit-wager-transaction.use-case.js';
import { MikroORM } from '@mikro-orm/core';
import { WalletLedgerEntryEntity } from '../../../src/infrastructure/persistence/mikro-orm/entities/wallet-ledger-entry.entity.js';
import { WagerTransactionEntity } from '../../../src/infrastructure/persistence/mikro-orm/entities/wager-transaction.entity.js';
import { createTestApp } from '../../support/test-app.js';

function uniqueProvider(): string {
  return `test-provider-${randomUUID()}`;
}

describe('SubmitWagerTransactionUseCase (integration)', () => {
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

  it('atomically applies a BET: wallet, ledger and transaction all move together', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    const result = await submit.execute({
      providerId,
      externalTransactionId: 'ext-1',
      idempotencyKey: `${providerId}:ext-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
    });

    expect(result.status).toBe(WagerTransactionStatus.Processed);
    expect(result.balance).toEqual({ amount: '75.00', currency: 'BRL' });
    expect(result.idempotentReplay).toBe(false);

    const em = orm.em.fork();
    const ledgerEntry = await em
      .getRepository(WalletLedgerEntryEntity)
      .findOne({ walletId: wallet.id, transactionId: result.transactionId });
    expect(ledgerEntry).not.toBeNull();
    expect(ledgerEntry?.balanceBefore).toBe('100.00');
    expect(ledgerEntry?.balanceAfter).toBe('75.00');

    const transactionEntity = await em
      .getRepository(WagerTransactionEntity)
      .findOne({ id: result.transactionId });
    expect(transactionEntity?.status).toBe(WagerTransactionStatus.Processed);
  });

  it('rejects a BET with insufficient funds and does not move the wallet', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '10.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    const result = await submit.execute({
      providerId,
      externalTransactionId: 'ext-1',
      idempotencyKey: `${providerId}:ext-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '50.00', currency: 'BRL' }),
    });

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(result.balance).toEqual({ amount: '10.00', currency: 'BRL' });
  });

  it('replays an identical request idempotently without duplicating the ledger', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();
    const command = {
      providerId,
      externalTransactionId: 'ext-1',
      idempotencyKey: `${providerId}:ext-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
    };

    const first = await submit.execute(command);
    const second = await submit.execute({
      ...command,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
    });

    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(second.balance).toEqual(first.balance);

    const em = orm.em.fork();
    const count = await em
      .getRepository(WalletLedgerEntryEntity)
      .count({ transactionId: first.transactionId });
    expect(count).toBe(1);
  });

  it('rejects the same idempotency key reused with a different payload', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();
    const idempotencyKey = `${providerId}:ext-1`;

    await submit.execute({
      providerId,
      externalTransactionId: 'ext-1',
      idempotencyKey,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
    });

    await expect(
      submit.execute({
        providerId,
        externalTransactionId: 'ext-1',
        idempotencyKey,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: '30.00', currency: 'BRL' }),
      }),
    ).rejects.toThrow(IdempotencyPayloadConflictError);
  });

  it('rejects a different idempotency key claimed for the same provider+externalTransactionId', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    await submit.execute({
      providerId,
      externalTransactionId: 'ext-1',
      idempotencyKey: `${providerId}:ext-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
    });

    await expect(
      submit.execute({
        providerId,
        externalTransactionId: 'ext-1',
        idempotencyKey: `${providerId}:ext-1-a-completely-different-key`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: '25.00', currency: 'BRL' }),
      }),
    ).rejects.toThrow(ExternalTransactionIdempotencyMismatchError);
  });

  it('rejects a different idempotency key racing concurrently for the same provider+externalTransactionId', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();
    const buildCommand = (idempotencyKey: string) => ({
      providerId,
      externalTransactionId: 'ext-race',
      idempotencyKey,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
    });

    const results = await Promise.allSettled([
      submit.execute(buildCommand(`${providerId}:key-a`)),
      submit.execute(buildCommand(`${providerId}:key-b`)),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ExternalTransactionIdempotencyMismatchError,
    );

    const em = orm.em.fork();
    const count = await em
      .getRepository(WagerTransactionEntity)
      .count({ providerId, externalTransactionId: 'ext-race' });
    expect(count).toBe(1);
  });

  it('fails fast when the wallet does not exist', async () => {
    const providerId = uniqueProvider();

    await expect(
      submit.execute({
        providerId,
        externalTransactionId: 'ext-1',
        idempotencyKey: `${providerId}:ext-1`,
        playerId: randomUUID(),
        walletId: randomUUID(),
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: '10.00', currency: 'BRL' }),
      }),
    ).rejects.toThrow(WalletNotFoundError);
  });

  it('fails fast when the wallet exists but belongs to another player', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    await expect(
      submit.execute({
        providerId,
        externalTransactionId: 'ext-1',
        idempotencyKey: `${providerId}:ext-1`,
        playerId: randomUUID(),
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: '10.00', currency: 'BRL' }),
      }),
    ).rejects.toThrow(WalletOwnershipMismatchError);

    const em = orm.em.fork();
    const count = await em.getRepository(WalletLedgerEntryEntity).count({ walletId: wallet.id });
    expect(count).toBe(1);
  });

  it('marks a REFUND as PENDING_REFERENCE when the BET has not arrived yet, then resolves it', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

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
    expect(refundResult.balance).toEqual({ amount: '100.00', currency: 'BRL' });

    const betResult = await submit.execute({
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
    expect(betResult.status).toBe(WagerTransactionStatus.Processed);
  });

  it('accepts a WIN that optionally references the BET of the same round', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    await submit.execute({
      providerId,
      externalTransactionId: 'ext-bet-win',
      idempotencyKey: `${providerId}:ext-bet-win`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
    });

    const winResult = await submit.execute({
      providerId,
      externalTransactionId: 'ext-win-1',
      idempotencyKey: `${providerId}:ext-win-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Win,
      money: Money.from({ amount: '50.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-bet-win',
    });

    expect(winResult.status).toBe(WagerTransactionStatus.Processed);
    expect(winResult.balance).toEqual({ amount: '125.00', currency: 'BRL' });
  });

  it('rejects a BET in a currency different from the wallet, auditable with CURRENCY_MISMATCH', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    const result = await submit.execute({
      providerId,
      externalTransactionId: 'ext-1',
      idempotencyKey: `${providerId}:ext-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '10.00', currency: 'USD' }),
    });

    expect(result.status).toBe(WagerTransactionStatus.Rejected);
    expect(result.failureCode).toBe(FailureCode.CurrencyMismatch);
    expect(result.balance).toEqual({ amount: '100.00', currency: 'BRL' });

    const em = orm.em.fork();
    const transactionEntity = await em
      .getRepository(WagerTransactionEntity)
      .findOne({ id: result.transactionId });
    expect(transactionEntity?.status).toBe(WagerTransactionStatus.Rejected);
    expect(transactionEntity?.failureCode).toBe(FailureCode.CurrencyMismatch);

    const ledgerCount = await em
      .getRepository(WalletLedgerEntryEntity)
      .count({ walletId: wallet.id });
    expect(ledgerCount).toBe(1);
  });

  it('rejects a REFUND referencing a BET that already reached a terminal non-PROCESSED state, instead of waiting on it', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '5.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    const failedBet = await submit.execute({
      providerId,
      externalTransactionId: 'ext-bet-failed',
      idempotencyKey: `${providerId}:ext-bet-failed`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '50.00', currency: 'BRL' }),
    });
    expect(failedBet.status).toBe(WagerTransactionStatus.Rejected);

    const refundResult = await submit.execute({
      providerId,
      externalTransactionId: 'ext-refund-1',
      idempotencyKey: `${providerId}:ext-refund-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: '50.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'ext-bet-failed',
    });

    expect(refundResult.status).toBe(WagerTransactionStatus.Rejected);
    expect(refundResult.failureCode).toBe(FailureCode.ReferenceNeverProcessed);
    expect(refundResult.balance).toEqual({ amount: '5.00', currency: 'BRL' });
  });
});
