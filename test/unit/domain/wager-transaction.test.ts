import { describe, expect, it } from 'bun:test';
import { Money } from '../../../src/domain/money/money.js';
import { LedgerDirection } from '../../../src/domain/wallet/ledger-direction.js';
import { FailureCode } from '../../../src/domain/wagering/failure-code.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../../../src/domain/wagering/wager-transaction-status.js';
import { WagerTransaction } from '../../../src/domain/wagering/wager-transaction.js';
import {
  InvalidTransactionStateError,
  LedgerDirectionUndefinedError,
  MissingReferenceError,
  RollbackWithoutReferenceError,
  UnexpectedReferenceError,
} from '../../../src/domain/wagering/wagering.errors.js';

const SNAPSHOT = Money.from({ amount: '75.00', currency: 'BRL' });

function buildTransaction(overrides: Partial<Parameters<typeof WagerTransaction.create>[0]> = {}) {
  return WagerTransaction.create({
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
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  });
}

describe('WagerTransaction', () => {
  describe('create', () => {
    it('starts in PENDING', () => {
      const transaction = buildTransaction();

      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
      expect(transaction.isTerminal()).toBe(false);
    });

    it('requires a reference for REFUND and ROLLBACK', () => {
      expect(() =>
        buildTransaction({
          kind: WagerTransactionKind.Refund,
          referenceExternalTransactionId: undefined,
        }),
      ).toThrow(MissingReferenceError);
      expect(() =>
        buildTransaction({
          kind: WagerTransactionKind.Rollback,
          referenceExternalTransactionId: undefined,
        }),
      ).toThrow(MissingReferenceError);
    });

    it('rejects a reference on kinds that cannot carry one', () => {
      expect(() =>
        buildTransaction({
          kind: WagerTransactionKind.Bet,
          referenceExternalTransactionId: 'ext-0',
        }),
      ).toThrow(UnexpectedReferenceError);
      expect(() =>
        buildTransaction({
          kind: WagerTransactionKind.Loss,
          referenceExternalTransactionId: 'ext-0',
        }),
      ).toThrow(UnexpectedReferenceError);
    });

    it('allows WIN to optionally carry a reference back to the BET of the same round', () => {
      const withoutReference = buildTransaction({ kind: WagerTransactionKind.Win });
      expect(withoutReference.referenceExternalTransactionId).toBeUndefined();
      expect(withoutReference.requiresReference()).toBe(false);

      const withReference = buildTransaction({
        kind: WagerTransactionKind.Win,
        referenceExternalTransactionId: 'ext-bet-0',
      });
      expect(withReference.referenceExternalTransactionId).toBe('ext-bet-0');
      expect(withReference.requiresReference()).toBe(false);
    });
  });

  describe('transitions', () => {
    it('moves to PROCESSED and records when it happened', () => {
      const transaction = buildTransaction();
      const at = new Date('2026-01-01T00:01:00Z');

      transaction.markProcessed('ref-tx-1', at, SNAPSHOT);

      expect(transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(transaction.referenceTransactionId).toBe('ref-tx-1');
      expect(transaction.processedAt).toBe(at);
      expect(transaction.isTerminal()).toBe(true);
      expect(transaction.balanceSnapshot).toBe(SNAPSHOT);
    });

    it('moves to REJECTED with a failure code', () => {
      const transaction = buildTransaction();

      transaction.reject(FailureCode.InsufficientFunds, SNAPSHOT);

      expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
      expect(transaction.failureCode).toBe(FailureCode.InsufficientFunds);
      expect(transaction.balanceSnapshot).toBe(SNAPSHOT);
    });

    it('moves to FAILED with a failure code', () => {
      const transaction = buildTransaction();

      transaction.fail(FailureCode.InfrastructureTransientFailure, SNAPSHOT);

      expect(transaction.status).toBe(WagerTransactionStatus.Failed);
      expect(transaction.failureCode).toBe(FailureCode.InfrastructureTransientFailure);
      expect(transaction.balanceSnapshot).toBe(SNAPSHOT);
    });

    it('moves to PENDING_REFERENCE', () => {
      const transaction = buildTransaction({
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: 'ext-0',
      });

      transaction.markPendingReference(SNAPSHOT);

      expect(transaction.status).toBe(WagerTransactionStatus.PendingReference);
      expect(transaction.isTerminal()).toBe(false);
      expect(transaction.balanceSnapshot).toBe(SNAPSHOT);
    });

    it.each([
      (t: WagerTransaction) => t.markProcessed(undefined, new Date(), SNAPSHOT),
      (t: WagerTransaction) => t.markPendingReference(SNAPSHOT),
      (t: WagerTransaction) => t.reject(FailureCode.InsufficientFunds, SNAPSHOT),
      (t: WagerTransaction) => t.fail(FailureCode.InfrastructureTransientFailure, SNAPSHOT),
    ])(
      'refuses any further transition once terminal',
      (transition: (t: WagerTransaction) => void) => {
        const transaction = buildTransaction();
        transaction.markProcessed(undefined, new Date(), SNAPSHOT);

        expect(() => transition(transaction)).toThrow(InvalidTransactionStateError);
      },
    );
  });

  describe('scheduleReferenceRetry', () => {
    it('only applies while PENDING_REFERENCE and increments the attempt counter', () => {
      const transaction = buildTransaction({
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: 'ext-0',
      });
      transaction.markPendingReference(SNAPSHOT);

      transaction.scheduleReferenceRetry(new Date('2026-01-01T00:05:00Z'));

      expect(transaction.pendingReferenceAttempts).toBe(1);
      expect(transaction.nextReferenceAttemptAt).toEqual(new Date('2026-01-01T00:05:00Z'));
    });

    it('refuses to schedule a retry outside PENDING_REFERENCE', () => {
      const transaction = buildTransaction();

      expect(() => transaction.scheduleReferenceRetry(new Date())).toThrow(
        InvalidTransactionStateError,
      );
    });
  });

  describe('affectsBalance', () => {
    it('is false only for LOSS', () => {
      expect(buildTransaction({ kind: WagerTransactionKind.Loss }).affectsBalance()).toBe(false);
      expect(buildTransaction({ kind: WagerTransactionKind.Bet }).affectsBalance()).toBe(true);
      expect(buildTransaction({ kind: WagerTransactionKind.Win }).affectsBalance()).toBe(true);
    });
  });

  describe('matchesPayload', () => {
    it('compares against the stored payload hash', () => {
      const transaction = buildTransaction();

      expect(transaction.matchesPayload('hash-1')).toBe(true);
      expect(transaction.matchesPayload('hash-2')).toBe(false);
    });
  });

  describe('ledgerDirectionFor', () => {
    it('resolves the fixed direction for BET, WIN, REFUND and OPENING', () => {
      expect(buildTransaction({ kind: WagerTransactionKind.Bet }).ledgerDirectionFor()).toBe(
        LedgerDirection.Debit,
      );
      expect(buildTransaction({ kind: WagerTransactionKind.Win }).ledgerDirectionFor()).toBe(
        LedgerDirection.Credit,
      );
      expect(
        buildTransaction({
          kind: WagerTransactionKind.Refund,
          referenceExternalTransactionId: 'ext-0',
        }).ledgerDirectionFor(),
      ).toBe(LedgerDirection.Credit);
      expect(buildTransaction({ kind: WagerTransactionKind.Opening }).ledgerDirectionFor()).toBe(
        LedgerDirection.Credit,
      );
    });

    it('inverts the direction of the referenced transaction for ROLLBACK', () => {
      const bet = buildTransaction({ kind: WagerTransactionKind.Bet });
      const rollbackOfBet = buildTransaction({
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: 'ext-0',
      });

      expect(rollbackOfBet.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);

      const win = buildTransaction({ kind: WagerTransactionKind.Win });
      const rollbackOfWin = buildTransaction({
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: 'ext-0',
      });

      expect(rollbackOfWin.ledgerDirectionFor(win)).toBe(LedgerDirection.Debit);
    });

    it('refuses to resolve a direction for LOSS, which never affects the balance', () => {
      const loss = buildTransaction({ kind: WagerTransactionKind.Loss });

      expect(() => loss.ledgerDirectionFor()).toThrow(LedgerDirectionUndefinedError);
    });

    it('refuses to resolve a direction for ROLLBACK without its reference', () => {
      const rollback = buildTransaction({
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: 'ext-0',
      });

      expect(() => rollback.ledgerDirectionFor()).toThrow(RollbackWithoutReferenceError);
    });
  });
});
