import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Money } from '../../../src/domain/money/money.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../../../src/domain/wagering/wager-transaction-status.js';
import { CreateWalletUseCase } from '../../../src/application/wallet/create-wallet.use-case.js';
import { SubmitWagerTransactionUseCase } from '../../../src/application/wagering/submit-wager-transaction.use-case.js';
import {
  WagerTransactionNotFoundError,
  WagerTransactionQueryService,
} from '../../../src/application/wagering/wager-transaction-query.service.js';
import { createTestApp } from '../../support/test-app.js';

function uniqueProvider(): string {
  return `test-provider-${randomUUID()}`;
}

describe('WagerTransactionQueryService (integration)', () => {
  let app: INestApplicationContext;
  let createWallet: CreateWalletUseCase;
  let submit: SubmitWagerTransactionUseCase;
  let query: WagerTransactionQueryService;

  beforeAll(async () => {
    app = await createTestApp();
    createWallet = app.get(CreateWalletUseCase);
    submit = app.get(SubmitWagerTransactionUseCase);
    query = app.get(WagerTransactionQueryService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('finds a transaction by id with the expected view fields', async () => {
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

    const view = await query.getById(result.transactionId);

    expect(view.transactionId).toBe(result.transactionId);
    expect(view.providerId).toBe(providerId);
    expect(view.externalTransactionId).toBe('ext-1');
    expect(view.walletId).toBe(wallet.id);
    expect(view.kind).toBe(WagerTransactionKind.Bet);
    expect(view.status).toBe(WagerTransactionStatus.Processed);
    expect(view.money).toEqual({ amount: '25.00', currency: 'BRL' });
    expect(view.failureCode).toBeNull();
    expect(view.processedAt).toBeDefined();
  });

  it('rejects an unknown transaction id', async () => {
    await expect(query.getById(randomUUID())).rejects.toThrow(WagerTransactionNotFoundError);
  });

  it('finds a transaction by provider and external id', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = uniqueProvider();

    const result = await submit.execute({
      providerId,
      externalTransactionId: 'ext-lookup',
      idempotencyKey: `${providerId}:ext-lookup`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '10.00', currency: 'BRL' }),
    });

    const view = await query.getByProviderAndExternalId(providerId, 'ext-lookup');

    expect(view.transactionId).toBe(result.transactionId);
  });

  it('rejects an unknown provider/external id pair', async () => {
    const providerId = uniqueProvider();

    await expect(query.getByProviderAndExternalId(providerId, 'does-not-exist')).rejects.toThrow(
      WagerTransactionNotFoundError,
    );
  });
});
