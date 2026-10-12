import { describe, expect, it } from 'bun:test';
import { Money } from '../../../src/domain/money/money.js';
import {
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
} from '../../../src/domain/money/money.errors.js';

describe('Money', () => {
  describe('from', () => {
    it('parses a valid decimal string with scale 2', () => {
      const money = Money.from({ amount: '25.00', currency: 'BRL' });

      expect(money.toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
    });

    it.each(['NaN', 'Infinity', '-Infinity', '1e10', '', '25', '25.0', '25.001', '-25.00'])(
      'rejects %s as an invalid amount',
      (amount: string) => {
        expect(() => Money.from({ amount, currency: 'BRL' })).toThrow(InvalidMoneyAmountError);
      },
    );

    it.each(['brl', 'BR', 'BRLL', '123'])(
      'rejects %s as an invalid currency',
      (currency: string) => {
        expect(() => Money.from({ amount: '10.00', currency })).toThrow(InvalidCurrencyError);
      },
    );
  });

  describe('zero', () => {
    it('creates a zero amount for the given currency', () => {
      const zero = Money.zero('BRL');

      expect(zero.isZero()).toBe(true);
      expect(zero.toJSON()).toEqual({ amount: '0.00', currency: 'BRL' });
    });
  });

  describe('arithmetic', () => {
    it('adds two amounts of the same currency', () => {
      const a = Money.from({ amount: '10.00', currency: 'BRL' });
      const b = Money.from({ amount: '5.50', currency: 'BRL' });

      expect(a.add(b).toJSON()).toEqual({ amount: '15.50', currency: 'BRL' });
    });

    it('subtracts two amounts of the same currency', () => {
      const a = Money.from({ amount: '10.00', currency: 'BRL' });
      const b = Money.from({ amount: '5.50', currency: 'BRL' });

      expect(a.subtract(b).toJSON()).toEqual({ amount: '4.50', currency: 'BRL' });
    });

    it('allows the subtraction result to go negative for domain-level checks', () => {
      const a = Money.from({ amount: '10.00', currency: 'BRL' });
      const b = Money.from({ amount: '15.00', currency: 'BRL' });

      expect(a.subtract(b).isNegative()).toBe(true);
    });

    it('negates an amount', () => {
      const a = Money.from({ amount: '10.00', currency: 'BRL' });

      expect(a.negate().toJSON()).toEqual({ amount: '-10.00', currency: 'BRL' });
    });

    it.each([
      ['add', (a: Money, b: Money) => a.add(b)],
      ['subtract', (a: Money, b: Money) => a.subtract(b)],
      ['isLessThan', (a: Money, b: Money) => a.isLessThan(b)],
    ] as const)(
      'throws CurrencyMismatchError on %s across currencies',
      (_name: string, operation: (a: Money, b: Money) => unknown) => {
        const brl = Money.from({ amount: '10.00', currency: 'BRL' });
        const usd = Money.from({ amount: '10.00', currency: 'USD' });

        expect(() => operation(brl, usd)).toThrow(CurrencyMismatchError);
      },
    );
  });

  describe('comparisons', () => {
    it('reports isPositive, isNegative and isZero correctly', () => {
      expect(Money.from({ amount: '1.00', currency: 'BRL' }).isPositive()).toBe(true);
      expect(Money.zero('BRL').isPositive()).toBe(false);
      expect(Money.zero('BRL').isZero()).toBe(true);
    });

    it('compares amounts of the same currency', () => {
      const small = Money.from({ amount: '5.00', currency: 'BRL' });
      const big = Money.from({ amount: '10.00', currency: 'BRL' });

      expect(small.isLessThan(big)).toBe(true);
      expect(big.isLessThan(small)).toBe(false);
    });

    it('returns false from equals when currencies differ, without throwing', () => {
      const brl = Money.from({ amount: '10.00', currency: 'BRL' });
      const usd = Money.from({ amount: '10.00', currency: 'USD' });

      expect(brl.equals(usd)).toBe(false);
    });

    it('returns true from equals when amount and currency match', () => {
      const a = Money.from({ amount: '10.00', currency: 'BRL' });
      const b = Money.from({ amount: '10.00', currency: 'BRL' });

      expect(a.equals(b)).toBe(true);
    });
  });

  describe('serialization', () => {
    it('renders toString with amount and currency', () => {
      const money = Money.from({ amount: '10.00', currency: 'BRL' });

      expect(money.toString()).toBe('10.00 BRL');
    });
  });
});
