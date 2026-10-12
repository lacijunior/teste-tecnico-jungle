import { Decimal } from 'decimal.js';
import {
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
} from './money.errors.js';

export interface MoneyProps {
  amount: string;
  currency: string;
}

const AMOUNT_PATTERN = /^\d+\.\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  public static from(props: MoneyProps): Money {
    if (!AMOUNT_PATTERN.test(props.amount)) {
      throw new InvalidMoneyAmountError(props.amount);
    }
    const currency = this.validateCurrency(props.currency);
    return new Money(new Decimal(props.amount), currency);
  }

  public static zero(currency: string): Money {
    return new Money(new Decimal(0), this.validateCurrency(currency));
  }

  private static validateCurrency(rawCurrency: string): string {
    if (!CURRENCY_PATTERN.test(rawCurrency)) {
      throw new InvalidCurrencyError(rawCurrency);
    }
    return rawCurrency;
  }

  private static unchecked(value: Decimal, currency: string): Money {
    return new Money(value, currency);
  }

  public add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.unchecked(this.value.plus(other.value), this.currency);
  }

  public subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.unchecked(this.value.minus(other.value), this.currency);
  }

  public negate(): Money {
    return Money.unchecked(this.value.negated(), this.currency);
  }

  public isZero(): boolean {
    return this.value.isZero();
  }

  public isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  public isNegative(): boolean {
    return this.value.lessThan(0);
  }

  public isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  public equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  public toJSON(): MoneyProps {
    return { amount: this.value.toFixed(2), currency: this.currency };
  }

  public toString(): string {
    return `${this.value.toFixed(2)} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
