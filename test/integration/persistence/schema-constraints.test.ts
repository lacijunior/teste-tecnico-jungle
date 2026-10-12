import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { MikroORM } from '@mikro-orm/postgresql';
import { createTestOrm } from '../../support/orm.js';

describe('schema constraints', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await createTestOrm();
  });

  afterAll(async () => {
    await orm.close();
  });

  it('rejects a negative wallet balance via CHECK constraint', async () => {
    const connection = orm.em.getConnection();
    const walletId = randomUUID();

    await expect(
      connection.execute(
        `insert into wallets (id, player_id, currency, balance_amount, created_at, updated_at)
         values (?, ?, 'BRL', -5.00, now(), now())`,
        [walletId, randomUUID()],
      ),
    ).rejects.toThrow(/wallets_balance_amount_non_negative/);
  });

  it('rejects a duplicate wallet for the same player and currency', async () => {
    const connection = orm.em.getConnection();
    const playerId = randomUUID();

    await connection.execute(
      `insert into wallets (id, player_id, currency, balance_amount, created_at, updated_at)
       values (?, ?, 'BRL', 0.00, now(), now())`,
      [randomUUID(), playerId],
    );

    await expect(
      connection.execute(
        `insert into wallets (id, player_id, currency, balance_amount, created_at, updated_at)
         values (?, ?, 'BRL', 0.00, now(), now())`,
        [randomUUID(), playerId],
      ),
    ).rejects.toThrow(/wallets_player_id_currency_unique/);
  });

  it('rejects a duplicate idempotency_key on wager_transactions', async () => {
    const connection = orm.em.getConnection();
    const walletId = randomUUID();
    const idempotencyKey = `provider-a:${randomUUID()}`;

    await connection.execute(
      `insert into wallets (id, player_id, currency, balance_amount, created_at, updated_at)
       values (?, ?, 'BRL', 100.00, now(), now())`,
      [walletId, randomUUID()],
    );
    await connection.execute(
      `insert into wager_transactions (
         id, provider_id, external_transaction_id, idempotency_key, payload_hash,
         wallet_id, player_id, round_id, game_id, kind, money_amount, money_currency,
         status, pending_reference_attempts, created_at
       ) values (?, 'provider-a', ?, ?, 'hash', ?, ?, 'round-1', 'game-1', 'BET', 25.00, 'BRL', 'PROCESSED', 0, now())`,
      [randomUUID(), randomUUID(), idempotencyKey, walletId, randomUUID()],
    );

    await expect(
      connection.execute(
        `insert into wager_transactions (
           id, provider_id, external_transaction_id, idempotency_key, payload_hash,
           wallet_id, player_id, round_id, game_id, kind, money_amount, money_currency,
           status, pending_reference_attempts, created_at
         ) values (?, 'provider-a', ?, ?, 'hash', ?, ?, 'round-1', 'game-1', 'BET', 25.00, 'BRL', 'PROCESSED', 0, now())`,
        [randomUUID(), randomUUID(), idempotencyKey, walletId, randomUUID()],
      ),
    ).rejects.toThrow(/wager_transactions_idempotency_key_unique/);
  });

  it('rejects a duplicate (provider_id, external_transaction_id) pair on wager_transactions', async () => {
    const connection = orm.em.getConnection();
    const walletId = randomUUID();
    const providerId = `provider-${randomUUID()}`;
    const externalTransactionId = 'ext-1';

    await connection.execute(
      `insert into wallets (id, player_id, currency, balance_amount, created_at, updated_at)
       values (?, ?, 'BRL', 100.00, now(), now())`,
      [walletId, randomUUID()],
    );
    await connection.execute(
      `insert into wager_transactions (
         id, provider_id, external_transaction_id, idempotency_key, payload_hash,
         wallet_id, player_id, round_id, game_id, kind, money_amount, money_currency,
         status, pending_reference_attempts, created_at
       ) values (?, ?, ?, ?, 'hash', ?, ?, 'round-1', 'game-1', 'BET', 25.00, 'BRL', 'PROCESSED', 0, now())`,
      [
        randomUUID(),
        providerId,
        externalTransactionId,
        `${providerId}:${externalTransactionId}`,
        walletId,
        randomUUID(),
      ],
    );

    await expect(
      connection.execute(
        `insert into wager_transactions (
           id, provider_id, external_transaction_id, idempotency_key, payload_hash,
           wallet_id, player_id, round_id, game_id, kind, money_amount, money_currency,
           status, pending_reference_attempts, created_at
         ) values (?, ?, ?, ?, 'hash', ?, ?, 'round-1', 'game-1', 'BET', 25.00, 'BRL', 'PROCESSED', 0, now())`,
        [randomUUID(), providerId, externalTransactionId, randomUUID(), walletId, randomUUID()],
      ),
    ).rejects.toThrow(/wager_transactions_provider_id_external_transaction_id_unique/);
  });

  it('rejects a duplicate (wallet_id, transaction_id) pair on wallet_ledger_entries', async () => {
    const connection = orm.em.getConnection();
    const walletId = randomUUID();
    const transactionId = randomUUID();

    await connection.execute(
      `insert into wallets (id, player_id, currency, balance_amount, created_at, updated_at)
       values (?, ?, 'BRL', 100.00, now(), now())`,
      [walletId, randomUUID()],
    );
    await connection.execute(
      `insert into wager_transactions (
         id, provider_id, external_transaction_id, idempotency_key, payload_hash,
         wallet_id, player_id, round_id, game_id, kind, money_amount, money_currency,
         status, pending_reference_attempts, created_at
       ) values (?, 'provider-a', ?, ?, 'hash', ?, ?, 'round-1', 'game-1', 'BET', 25.00, 'BRL', 'PROCESSED', 0, now())`,
      [transactionId, randomUUID(), randomUUID(), walletId, randomUUID()],
    );
    await connection.execute(
      `insert into wallet_ledger_entries (
         id, wallet_id, transaction_id, direction, money_amount, money_currency,
         balance_before, balance_after, created_at
       ) values (?, ?, ?, 'DEBIT', 25.00, 'BRL', 100.00, 75.00, now())`,
      [randomUUID(), walletId, transactionId],
    );

    await expect(
      connection.execute(
        `insert into wallet_ledger_entries (
           id, wallet_id, transaction_id, direction, money_amount, money_currency,
           balance_before, balance_after, created_at
         ) values (?, ?, ?, 'DEBIT', 25.00, 'BRL', 100.00, 75.00, now())`,
        [randomUUID(), walletId, transactionId],
      ),
    ).rejects.toThrow(/wallet_ledger_entries_wallet_id_transaction_id_unique/);
  });

  it('rejects a duplicate (consumer_name, message_id) pair on inbox_messages', async () => {
    const connection = orm.em.getConnection();
    const consumerName = 'wagering-transactions-consumer';
    const messageId = `msg-${randomUUID()}`;

    await connection.execute(
      `insert into inbox_messages (consumer_name, message_id, payload_hash, received_at)
       values (?, ?, 'hash', now())`,
      [consumerName, messageId],
    );

    await expect(
      connection.execute(
        `insert into inbox_messages (consumer_name, message_id, payload_hash, received_at)
         values (?, ?, 'hash', now())`,
        [consumerName, messageId],
      ),
    ).rejects.toThrow(/inbox_messages_pkey/);
  });

  it('blocks UPDATE and DELETE on wallet_ledger_entries via trigger', async () => {
    const connection = orm.em.getConnection();
    const walletId = randomUUID();
    const transactionId = randomUUID();
    const entryId = randomUUID();

    await connection.execute(
      `insert into wallets (id, player_id, currency, balance_amount, created_at, updated_at)
       values (?, ?, 'BRL', 100.00, now(), now())`,
      [walletId, randomUUID()],
    );
    await connection.execute(
      `insert into wager_transactions (
         id, provider_id, external_transaction_id, idempotency_key, payload_hash,
         wallet_id, player_id, round_id, game_id, kind, money_amount, money_currency,
         status, pending_reference_attempts, created_at
       ) values (?, 'provider-a', ?, ?, 'hash', ?, ?, 'round-1', 'game-1', 'BET', 25.00, 'BRL', 'PROCESSED', 0, now())`,
      [transactionId, randomUUID(), randomUUID(), walletId, randomUUID()],
    );
    await connection.execute(
      `insert into wallet_ledger_entries (
         id, wallet_id, transaction_id, direction, money_amount, money_currency,
         balance_before, balance_after, created_at
       ) values (?, ?, ?, 'DEBIT', 25.00, 'BRL', 100.00, 75.00, now())`,
      [entryId, walletId, transactionId],
    );

    await expect(
      connection.execute(`update wallet_ledger_entries set balance_after = 999.00 where id = ?`, [
        entryId,
      ]),
    ).rejects.toThrow(/immutable/);

    await expect(
      connection.execute(`delete from wallet_ledger_entries where id = ?`, [entryId]),
    ).rejects.toThrow(/immutable/);
  });
});
