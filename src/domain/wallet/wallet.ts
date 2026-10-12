import { Money, type MoneyProps } from '../money/money.js';
import { InsufficientBalanceError, WalletCurrencyMismatchError } from './wallet.errors.js';

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: MoneyProps;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
  now: Date;
}

export interface WalletMutation {
  balanceBefore: Money;
  balanceAfter: Money;
}

export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  public static open(props: OpenWalletProps): Wallet {
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      props.now,
      props.now,
    );
  }

  public static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      Money.from(state.balance),
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  public get balance(): Money {
    return this._balance;
  }

  public get version(): number {
    return this._version;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }

  public debit(money: Money, now: Date): WalletMutation {
    this.assertSameCurrency(money);
    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.subtract(money);
    if (balanceAfter.isNegative()) {
      throw new InsufficientBalanceError(this.id, balanceAfter.toString());
    }
    this.applyMutation(balanceAfter, now);
    return { balanceBefore, balanceAfter };
  }

  public credit(money: Money, now: Date): WalletMutation {
    this.assertSameCurrency(money);
    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.add(money);
    this.applyMutation(balanceAfter, now);
    return { balanceBefore, balanceAfter };
  }

  private applyMutation(balanceAfter: Money, now: Date): void {
    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = now;
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new WalletCurrencyMismatchError(this.id, this.currency, money.currency);
    }
  }
}
