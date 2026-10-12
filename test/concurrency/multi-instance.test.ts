import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { Money } from '../../src/domain/money/money.js';
import { WagerTransactionKind } from '../../src/domain/wagering/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../../src/domain/wagering/wager-transaction-status.js';
import { LedgerDirection } from '../../src/domain/wallet/ledger-direction.js';
import { CreateWalletUseCase } from '../../src/application/wallet/create-wallet.use-case.js';
import { SubmitWagerTransactionUseCase } from '../../src/application/wagering/submit-wager-transaction.use-case.js';
import { WalletEntity } from '../../src/infrastructure/persistence/mikro-orm/entities/wallet.entity.js';
import { WalletLedgerEntryEntity } from '../../src/infrastructure/persistence/mikro-orm/entities/wallet-ledger-entry.entity.js';
import { createTestApp } from '../support/test-app.js';

describe('three or more application instances hitting the same wallet', () => {
  let instances: INestApplicationContext[];
  let orm: MikroORM;

  beforeAll(async () => {
    instances = await Promise.all([
      createTestApp(),
      createTestApp(),
      createTestApp(),
      createTestApp(),
    ]);
    orm = instances[0].get(MikroORM);
  });

  afterAll(async () => {
    await Promise.all(instances.map((app) => app.close()));
  });

  it('keeps the wallet correct when 4 separate Nest instances submit bets concurrently', async () => {
    const createWallet = instances[0].get(CreateWalletUseCase);
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '1000.00', currency: 'BRL' }),
    });

    const providerId = `multi-instance-${randomUUID()}`;
    const results = await Promise.all(
      instances.map((app, index) =>
        app.get(SubmitWagerTransactionUseCase).execute({
          providerId,
          externalTransactionId: `ext-${index}`,
          idempotencyKey: `${providerId}:ext-${index}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: 'round-1',
          gameId: 'fortune-chimp',
          kind: WagerTransactionKind.Bet,
          money: Money.from({ amount: '50.00', currency: 'BRL' }),
        }),
      ),
    );

    expect(results.every((r) => r.status === WagerTransactionStatus.Processed)).toBe(true);

    const em = orm.em.fork();
    const finalWallet = await em.getRepository(WalletEntity).findOneOrFail({ id: wallet.id });
    expect(finalWallet.balanceAmount).toBe('800.00');

    const debitCount = await em.getRepository(WalletLedgerEntryEntity).count({
      walletId: wallet.id,
      direction: LedgerDirection.Debit,
    });
    expect(debitCount).toBe(4);
  }, 20_000);
});
