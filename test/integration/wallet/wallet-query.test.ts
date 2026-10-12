import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import { Money } from '../../../src/domain/money/money.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';
import { CreateWalletUseCase } from '../../../src/application/wallet/create-wallet.use-case.js';
import {
  InvalidLedgerCursorError,
  WalletAlreadyExistsError,
} from '../../../src/application/wallet/wallet-application.errors.js';
import { WalletQueryService } from '../../../src/application/wallet/wallet-query.service.js';
import { SubmitWagerTransactionUseCase } from '../../../src/application/wagering/submit-wager-transaction.use-case.js';
import { WalletEntity } from '../../../src/infrastructure/persistence/mikro-orm/entities/wallet.entity.js';
import { createTestApp } from '../../support/test-app.js';

describe('Wallet creation and reconciliation (integration)', () => {
  let app: INestApplicationContext;
  let createWallet: CreateWalletUseCase;
  let submit: SubmitWagerTransactionUseCase;
  let walletQuery: WalletQueryService;
  let orm: MikroORM;

  beforeAll(async () => {
    app = await createTestApp();
    createWallet = app.get(CreateWalletUseCase);
    submit = app.get(SubmitWagerTransactionUseCase);
    walletQuery = app.get(WalletQueryService);
    orm = app.get(MikroORM);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects creating a second wallet for the same player and currency', async () => {
    const playerId = randomUUID();
    await createWallet.execute({
      playerId,
      initialBalance: Money.from({ amount: '10.00', currency: 'BRL' }),
    });

    await expect(
      createWallet.execute({
        playerId,
        initialBalance: Money.from({ amount: '0.00', currency: 'BRL' }),
      }),
    ).rejects.toThrow(WalletAlreadyExistsError);
  });

  it('creates a wallet with zero initial balance without an OPENING ledger entry', async () => {
    const result = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '0.00', currency: 'BRL' }),
    });

    const page = await walletQuery.getLedger(result.id, undefined, 10);
    expect(page.entries).toHaveLength(0);
  });

  it('reports consistent reconciliation after a normal operation', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = `reconcile-${randomUUID()}`;

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

    const reconciliation = await walletQuery.reconcile(wallet.id);

    expect(reconciliation.consistent).toBe(true);
    expect(reconciliation.storedBalance).toEqual({ amount: '75.00', currency: 'BRL' });
    expect(reconciliation.calculatedBalance).toEqual({ amount: '75.00', currency: 'BRL' });
    expect(reconciliation.difference).toEqual({ amount: '0.00', currency: 'BRL' });
    expect(reconciliation.checkedEntries).toBe(2);
  });

  it('flags a divergence instead of silently fixing it', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    const em = orm.em.fork();
    await em
      .getConnection()
      .execute('update wallets set balance_amount = ? where id = ?', ['999.00', wallet.id]);

    const reconciliation = await walletQuery.reconcile(wallet.id);

    expect(reconciliation.consistent).toBe(false);
    expect(reconciliation.storedBalance).toEqual({ amount: '999.00', currency: 'BRL' });
    expect(reconciliation.calculatedBalance).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(reconciliation.difference).toEqual({ amount: '899.00', currency: 'BRL' });

    const finalWallet = await em.getRepository(WalletEntity).findOne({ id: wallet.id });
    expect(finalWallet?.balanceAmount).toBe('999.00');
  });

  it('rejects a malformed ledger cursor instead of silently returning an empty or wrong page', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '10.00', currency: 'BRL' }),
    });

    await expect(walletQuery.getLedger(wallet.id, 'not-a-valid-cursor', 10)).rejects.toThrow(
      InvalidLedgerCursorError,
    );
  });

  it('paginates the ledger with a stable cursor', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '1000.00', currency: 'BRL' }),
    });
    const providerId = `ledger-${randomUUID()}`;

    for (let i = 0; i < 5; i += 1) {
      await submit.execute({
        providerId,
        externalTransactionId: `ext-${i}`,
        idempotencyKey: `${providerId}:ext-${i}`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: '10.00', currency: 'BRL' }),
      });
    }

    const firstPage = await walletQuery.getLedger(wallet.id, undefined, 3);
    expect(firstPage.entries).toHaveLength(3);
    expect(firstPage.nextCursor).toBeDefined();

    const secondPage = await walletQuery.getLedger(wallet.id, firstPage.nextCursor, 3);
    expect(secondPage.entries.length).toBeGreaterThan(0);

    const firstIds = new Set(firstPage.entries.map((e) => e.id));
    for (const entry of secondPage.entries) {
      expect(firstIds.has(entry.id)).toBe(false);
    }
  });

  it('paginates correctly across entries that share the exact same createdAt', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '0.00', currency: 'BRL' }),
    });

    // Ledger rows are immutable (a DB trigger blocks UPDATE/DELETE even via raw SQL), so the
    // same-timestamp tie that concurrent writes could plausibly produce has to be inserted
    // directly rather than retrofitted onto rows created through the normal submit flow.
    const em = orm.em.fork();
    const connection = em.getConnection();
    const tiedAt = new Date('2026-01-01T00:00:00.000Z');
    const providerId = `ledger-tie-${randomUUID()}`;
    const entryIds: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const transactionId = randomUUID();
      const entryId = randomUUID();
      entryIds.push(entryId);
      await connection.execute(
        `insert into wager_transactions (
           id, provider_id, external_transaction_id, idempotency_key, payload_hash,
           wallet_id, player_id, round_id, game_id, kind, money_amount, money_currency,
           status, pending_reference_attempts, created_at
         ) values (?, ?, ?, ?, 'hash', ?, ?, 'round-1', 'game-1', 'BET', 10.00, 'BRL', 'PROCESSED', 0, ?)`,
        [
          transactionId,
          providerId,
          `ext-${i}`,
          `${providerId}:ext-${i}`,
          wallet.id,
          wallet.playerId,
          tiedAt,
        ],
      );
      await connection.execute(
        `insert into wallet_ledger_entries (
           id, wallet_id, transaction_id, direction, money_amount, money_currency,
           balance_before, balance_after, created_at
         ) values (?, ?, ?, 'DEBIT', 10.00, 'BRL', 0.00, 0.00, ?)`,
        [entryId, wallet.id, transactionId, tiedAt],
      );
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = await walletQuery.getLedger(wallet.id, cursor, 2);
      seen.push(...page.entries.map((e) => e.id));
      if (!page.nextCursor) {
        break;
      }
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(entryIds.length);
    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen)).toEqual(new Set(entryIds));
  });
});
