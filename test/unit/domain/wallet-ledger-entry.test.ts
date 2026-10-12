import { describe, expect, it } from 'bun:test';
import { Money } from '../../../src/domain/money/money.js';
import { LedgerDirection } from '../../../src/domain/wallet/ledger-direction.js';
import {
  UnbalancedLedgerEntryError,
  WalletLedgerEntry,
} from '../../../src/domain/wallet/wallet-ledger-entry.js';

describe('WalletLedgerEntry', () => {
  it('creates a balanced CREDIT entry', () => {
    const entry = WalletLedgerEntry.create({
      id: 'entry-1',
      walletId: 'wallet-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
      balanceAfter: Money.from({ amount: '125.00', currency: 'BRL' }),
      createdAt: new Date(),
    });

    expect(entry.isBalanced()).toBe(true);
  });

  it('creates a balanced DEBIT entry', () => {
    const entry = WalletLedgerEntry.create({
      id: 'entry-1',
      walletId: 'wallet-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.Debit,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
      balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
      balanceAfter: Money.from({ amount: '75.00', currency: 'BRL' }),
      createdAt: new Date(),
    });

    expect(entry.isBalanced()).toBe(true);
  });

  it('refuses to create an entry whose arithmetic does not close', () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: 'entry-1',
        walletId: 'wallet-1',
        transactionId: 'tx-1',
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: '25.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '80.00', currency: 'BRL' }),
        createdAt: new Date(),
      }),
    ).toThrow(UnbalancedLedgerEntryError);
  });

  it('has no mutation methods, only queries, over immutable fields', () => {
    const entry = WalletLedgerEntry.rehydrate({
      id: 'entry-1',
      walletId: 'wallet-1',
      transactionId: 'tx-1',
      direction: LedgerDirection.Credit,
      money: { amount: '25.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '125.00', currency: 'BRL' },
      createdAt: new Date(),
    });

    expect(Object.getOwnPropertyNames(WalletLedgerEntry.prototype)).toEqual([
      'constructor',
      'isBalanced',
    ]);
    expect(entry.isBalanced()).toBe(true);
  });
});
