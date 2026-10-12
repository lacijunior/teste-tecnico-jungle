import { describe, expect, it } from 'bun:test';
import { IdempotencyKeyPolicy } from '../../../src/application/wagering/idempotency-key-policy.js';

describe('IdempotencyKeyPolicy', () => {
  it('builds the default key from provider and external transaction id', () => {
    expect(IdempotencyKeyPolicy.defaultKey('provider-a', 'transaction-123')).toBe(
      'provider-a:transaction-123',
    );
  });

  it('produces the same hash regardless of key order in the payload object', () => {
    const a = IdempotencyKeyPolicy.hashPayload({
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      playerId: 'player-1',
      walletId: 'wallet-1',
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    });
    const b = IdempotencyKeyPolicy.hashPayload({
      kind: 'BET',
      gameId: 'fortune-chimp',
      money: { currency: 'BRL', amount: '25.00' },
      roundId: 'round-1',
      walletId: 'wallet-1',
      playerId: 'player-1',
      externalTransactionId: 'ext-1',
      providerId: 'provider-a',
    });

    expect(a).toBe(b);
  });

  it('produces a different hash when a business field changes', () => {
    const base = {
      providerId: 'provider-a',
      externalTransactionId: 'ext-1',
      playerId: 'player-1',
      walletId: 'wallet-1',
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    };

    const original = IdempotencyKeyPolicy.hashPayload(base);
    const changed = IdempotencyKeyPolicy.hashPayload({
      ...base,
      money: { amount: '30.00', currency: 'BRL' },
    });

    expect(original).not.toBe(changed);
  });
});
