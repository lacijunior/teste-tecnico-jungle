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
import { WalletLockRetryPolicy } from '../../../src/application/wallet/wallet-lock-retry-policy.js';
import { PromWageringMetrics } from '../../../src/infrastructure/observability/prom-wagering-metrics.js';
import { WagerTransactionEntity } from '../../../src/infrastructure/persistence/mikro-orm/entities/wager-transaction.entity.js';
import { createTestApp } from '../../support/test-app.js';

describe('infrastructure failure after exhausting wallet lock retries (integration)', () => {
  let app: INestApplicationContext;
  let createWallet: CreateWalletUseCase;
  let submit: SubmitWagerTransactionUseCase;
  let orm: MikroORM;

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(WalletLockRetryPolicy)
        .useValue(
          new WalletLockRetryPolicy({ maxAttempts: 1, baseDelayMs: 1 }, new PromWageringMetrics()),
        ),
    );
    createWallet = app.get(CreateWalletUseCase);
    submit = app.get(SubmitWagerTransactionUseCase);
    orm = app.get(MikroORM);
  });

  afterAll(async () => {
    await app.close();
  });

  it('persists an auditable FAILED transaction with a balance snapshot when retries are exhausted', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '1000.00', currency: 'BRL' }),
    });
    const providerId = `infra-failure-${randomUUID()}`;
    const concurrentRequests = 15;

    const results = await Promise.all(
      Array.from({ length: concurrentRequests }, (_, index) =>
        submit.execute({
          providerId,
          externalTransactionId: `ext-${index}`,
          idempotencyKey: `${providerId}:ext-${index}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: 'round-1',
          gameId: 'fortune-chimp',
          kind: WagerTransactionKind.Bet,
          money: Money.from({ amount: '10.00', currency: 'BRL' }),
        }),
      ),
    );

    const failedResults = results.filter((r) => r.status === WagerTransactionStatus.Failed);
    const processedResults = results.filter((r) => r.status === WagerTransactionStatus.Processed);
    expect(failedResults.length).toBeGreaterThan(0);
    expect(failedResults.length + processedResults.length).toBe(concurrentRequests);

    const failed = failedResults[0]!;
    expect(failed.failureCode).toBe(FailureCode.InfrastructureTransientFailure);
    expect(failed.balance.currency).toBe('BRL');

    const em = orm.em.fork();
    const entity = await em
      .getRepository(WagerTransactionEntity)
      .findOne({ id: failed.transactionId });
    expect(entity?.status).toBe(WagerTransactionStatus.Failed);
    expect(entity?.failureCode).toBe(FailureCode.InfrastructureTransientFailure);
    expect(entity?.balanceSnapshotAmount).not.toBeUndefined();
  }, 15_000);
});
