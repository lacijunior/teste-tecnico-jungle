import { describe, expect, it } from 'bun:test';
import { Money } from '../../../src/domain/money/money.js';
import { OutboxMessage } from '../../../src/domain/messaging/outbox-message.js';
import { WagerTransactionProcessed } from '../../../src/domain/messaging/events/wager-transaction-processed.event.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';
import { WagerTransaction } from '../../../src/domain/wagering/wager-transaction.js';

function buildEvent() {
  const transaction = WagerTransaction.create({
    id: 'tx-1',
    providerId: 'provider-a',
    externalTransactionId: 'ext-1',
    idempotencyKey: 'provider-a:ext-1',
    payloadHash: 'hash-1',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'fortune-chimp',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
    createdAt: new Date(),
  });
  transaction.markProcessed(
    undefined,
    new Date(),
    Money.from({ amount: '75.00', currency: 'BRL' }),
  );

  return WagerTransactionProcessed.from(transaction, {
    eventId: 'event-1',
    correlationId: 'corr-1',
    occurredAt: new Date('2026-01-01T00:00:00Z'),
  });
}

describe('OutboxMessage', () => {
  it('starts pending and due immediately', () => {
    const message = OutboxMessage.enqueue(buildEvent());

    expect(message.isPending()).toBe(true);
    expect(message.isDue(new Date())).toBe(true);
    expect(message.attempts).toBe(0);
  });

  it('is no longer due or pending after being published', () => {
    const message = OutboxMessage.enqueue(buildEvent());

    message.markPublished(new Date());

    expect(message.isPending()).toBe(false);
    expect(message.isDue(new Date())).toBe(false);
  });

  it('schedules a growing backoff on each retry', () => {
    const message = OutboxMessage.enqueue(buildEvent());
    const now = new Date('2026-01-01T00:00:00Z');

    message.scheduleRetry(now);
    const firstDelay = message.nextAttemptAt!.getTime() - now.getTime();

    message.scheduleRetry(now);
    const secondDelay = message.nextAttemptAt!.getTime() - now.getTime();

    expect(message.attempts).toBe(2);
    expect(secondDelay).toBeGreaterThan(firstDelay);
    expect(message.isDue(now)).toBe(false);
  });
});
