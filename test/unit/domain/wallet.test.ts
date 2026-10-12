import { describe, expect, it } from 'bun:test';
import { Money } from '../../../src/domain/money/money.js';
import { Wallet } from '../../../src/domain/wallet/wallet.js';
import {
  InsufficientBalanceError,
  WalletCurrencyMismatchError,
} from '../../../src/domain/wallet/wallet.errors.js';

function openWallet(initial = '100.00'): Wallet {
  return Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: Money.from({ amount: initial, currency: 'BRL' }),
    now: new Date('2026-01-01T00:00:00Z'),
  });
}

describe('Wallet', () => {
  describe('open', () => {
    it('starts at version 1 regardless of the initial balance', () => {
      const wallet = openWallet('1000.00');

      expect(wallet.version).toBe(1);
      expect(wallet.balance.toJSON()).toEqual({ amount: '1000.00', currency: 'BRL' });
    });

    it('uses the provided instant for createdAt and updatedAt instead of the current time', () => {
      const now = new Date('2026-03-15T12:00:00Z');
      const wallet = Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: Money.from({ amount: '0.00', currency: 'BRL' }),
        now,
      });

      expect(wallet.createdAt).toBe(now);
      expect(wallet.updatedAt).toBe(now);
    });
  });

  describe('debit', () => {
    it('decreases the balance and bumps the version', () => {
      const wallet = openWallet('100.00');

      const mutation = wallet.debit(Money.from({ amount: '25.00', currency: 'BRL' }), new Date());

      expect(wallet.balance.toJSON()).toEqual({ amount: '75.00', currency: 'BRL' });
      expect(wallet.version).toBe(2);
      expect(mutation.balanceBefore.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
      expect(mutation.balanceAfter.toJSON()).toEqual({ amount: '75.00', currency: 'BRL' });
    });

    it('rejects a debit that would push the balance negative, without mutating state', () => {
      const wallet = openWallet('20.00');

      expect(() =>
        wallet.debit(Money.from({ amount: '80.00', currency: 'BRL' }), new Date()),
      ).toThrow(InsufficientBalanceError);
      expect(wallet.balance.toJSON()).toEqual({ amount: '20.00', currency: 'BRL' });
      expect(wallet.version).toBe(1);
    });

    it('rejects an operation in a different currency, without mutating state', () => {
      const wallet = openWallet('100.00');

      expect(() =>
        wallet.debit(Money.from({ amount: '10.00', currency: 'USD' }), new Date()),
      ).toThrow(WalletCurrencyMismatchError);
      expect(wallet.version).toBe(1);
    });

    it('allows the balance to reach exactly zero', () => {
      const wallet = openWallet('20.00');

      wallet.debit(Money.from({ amount: '20.00', currency: 'BRL' }), new Date());

      expect(wallet.balance.isZero()).toBe(true);
    });
  });

  describe('credit', () => {
    it('increases the balance and bumps the version', () => {
      const wallet = openWallet('100.00');

      const mutation = wallet.credit(Money.from({ amount: '50.00', currency: 'BRL' }), new Date());

      expect(wallet.balance.toJSON()).toEqual({ amount: '150.00', currency: 'BRL' });
      expect(wallet.version).toBe(2);
      expect(mutation.balanceAfter.toJSON()).toEqual({ amount: '150.00', currency: 'BRL' });
    });

    it('rejects an operation in a different currency', () => {
      const wallet = openWallet('100.00');

      expect(() =>
        wallet.credit(Money.from({ amount: '10.00', currency: 'USD' }), new Date()),
      ).toThrow(WalletCurrencyMismatchError);
    });
  });

  describe('rehydrate', () => {
    it('reconstructs the exact persisted state without reapplying transitions', () => {
      const wallet = Wallet.rehydrate({
        id: 'wallet-1',
        playerId: 'player-1',
        currency: 'BRL',
        balance: { amount: '42.00', currency: 'BRL' },
        version: 7,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      });

      expect(wallet.balance.toJSON()).toEqual({ amount: '42.00', currency: 'BRL' });
      expect(wallet.version).toBe(7);
    });
  });
});
