import { describe, expect, it } from 'bun:test';
import { Money } from '../../../src/domain/money/money.js';
import { ReferenceResolver } from '../../../src/domain/wagering/reference-resolver.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';
import { WagerTransaction } from '../../../src/domain/wagering/wager-transaction.js';
import {
  ReferenceAlreadyReversedError,
  ReferenceAmountMismatchError,
  ReferenceScopeMismatchError,
  ReferenceTypeInvalidError,
} from '../../../src/domain/wagering/wagering.errors.js';

function buildBet(
  overrides: Partial<{
    providerId: string;
    playerId: string;
    walletId: string;
    roundId: string;
    currency: string;
  }> = {},
) {
  return WagerTransaction.create({
    id: 'tx-bet',
    providerId: overrides.providerId ?? 'provider-a',
    externalTransactionId: 'ext-bet',
    idempotencyKey: 'provider-a:ext-bet',
    payloadHash: 'hash',
    walletId: overrides.walletId ?? 'wallet-1',
    playerId: overrides.playerId ?? 'player-1',
    roundId: overrides.roundId ?? 'round-1',
    gameId: 'fortune-chimp',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '25.00', currency: overrides.currency ?? 'BRL' }),
    createdAt: new Date(),
  });
}

const scope = {
  providerId: 'provider-a',
  playerId: 'player-1',
  walletId: 'wallet-1',
  currency: 'BRL',
  roundId: 'round-1',
};

describe('ReferenceResolver', () => {
  it('accepts a REFUND referencing a BET within the same scope and amount', () => {
    const bet = buildBet();
    bet.markProcessed(undefined, new Date(), Money.from({ amount: '75.00', currency: 'BRL' }));

    expect(() =>
      ReferenceResolver.ensureValid({
        reversingKind: WagerTransactionKind.Refund,
        reference: bet,
        scope,
        expectedMoney: Money.from({ amount: '25.00', currency: 'BRL' }),
        alreadyReversed: false,
      }),
    ).not.toThrow();
  });

  it('rejects a reference belonging to a different wallet', () => {
    const bet = buildBet({ walletId: 'wallet-2' });

    expect(() =>
      ReferenceResolver.ensureValid({
        reversingKind: WagerTransactionKind.Refund,
        reference: bet,
        scope,
        expectedMoney: Money.from({ amount: '25.00', currency: 'BRL' }),
        alreadyReversed: false,
      }),
    ).toThrow(ReferenceScopeMismatchError);
  });

  it('rejects a reference belonging to a different provider', () => {
    const bet = buildBet({ providerId: 'provider-b' });

    expect(() =>
      ReferenceResolver.ensureValid({
        reversingKind: WagerTransactionKind.Refund,
        reference: bet,
        scope,
        expectedMoney: Money.from({ amount: '25.00', currency: 'BRL' }),
        alreadyReversed: false,
      }),
    ).toThrow(ReferenceScopeMismatchError);
  });

  it('rejects a reference belonging to a different player', () => {
    const bet = buildBet({ playerId: 'player-2' });

    expect(() =>
      ReferenceResolver.ensureValid({
        reversingKind: WagerTransactionKind.Refund,
        reference: bet,
        scope,
        expectedMoney: Money.from({ amount: '25.00', currency: 'BRL' }),
        alreadyReversed: false,
      }),
    ).toThrow(ReferenceScopeMismatchError);
  });

  it('rejects a reference with a different currency', () => {
    const bet = buildBet({ currency: 'USD' });

    expect(() =>
      ReferenceResolver.ensureValid({
        reversingKind: WagerTransactionKind.Refund,
        reference: bet,
        scope,
        expectedMoney: Money.from({ amount: '25.00', currency: 'USD' }),
        alreadyReversed: false,
      }),
    ).toThrow(ReferenceScopeMismatchError);
  });

  it('rejects REFUND referencing a kind other than BET', () => {
    const win = WagerTransaction.create({
      id: 'tx-win',
      providerId: 'provider-a',
      externalTransactionId: 'ext-win',
      idempotencyKey: 'provider-a:ext-win',
      payloadHash: 'hash',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Win,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      createdAt: new Date(),
    });

    expect(() =>
      ReferenceResolver.ensureValid({
        reversingKind: WagerTransactionKind.Refund,
        reference: win,
        scope,
        expectedMoney: Money.from({ amount: '25.00', currency: 'BRL' }),
        alreadyReversed: false,
      }),
    ).toThrow(ReferenceTypeInvalidError);
  });

  it('accepts ROLLBACK referencing BET, WIN or REFUND', () => {
    for (const kind of [
      WagerTransactionKind.Bet,
      WagerTransactionKind.Win,
      WagerTransactionKind.Refund,
    ]) {
      const reference = WagerTransaction.create({
        id: `tx-${kind}`,
        providerId: 'provider-a',
        externalTransactionId: `ext-${kind}`,
        idempotencyKey: `provider-a:ext-${kind}`,
        payloadHash: 'hash',
        walletId: 'wallet-1',
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind,
        money: Money.from({ amount: '25.00', currency: 'BRL' }),
        referenceExternalTransactionId:
          kind === WagerTransactionKind.Refund ? 'ext-bet' : undefined,
        createdAt: new Date(),
      });

      expect(() =>
        ReferenceResolver.ensureValid({
          reversingKind: WagerTransactionKind.Rollback,
          reference,
          scope,
          expectedMoney: Money.from({ amount: '25.00', currency: 'BRL' }),
          alreadyReversed: false,
        }),
      ).not.toThrow();
    }
  });

  it('rejects a reversal whose amount does not match the reference', () => {
    const bet = buildBet();

    expect(() =>
      ReferenceResolver.ensureValid({
        reversingKind: WagerTransactionKind.Refund,
        reference: bet,
        scope,
        expectedMoney: Money.from({ amount: '10.00', currency: 'BRL' }),
        alreadyReversed: false,
      }),
    ).toThrow(ReferenceAmountMismatchError);
  });

  it('rejects a reference that was already reversed by the same operation type', () => {
    const bet = buildBet();

    expect(() =>
      ReferenceResolver.ensureValid({
        reversingKind: WagerTransactionKind.Refund,
        reference: bet,
        scope,
        expectedMoney: Money.from({ amount: '25.00', currency: 'BRL' }),
        alreadyReversed: true,
      }),
    ).toThrow(ReferenceAlreadyReversedError);
  });
});
