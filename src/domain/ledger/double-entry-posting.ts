import { DomainError } from '../errors/domain-error.js';
import { Money, type MoneyProps } from '../money/money.js';
import { LedgerDirection } from '../wallet/ledger-direction.js';
import { LedgerAccountType, sameAccount, type LedgerAccountRef } from './ledger-account.js';

export class SameAccountPostingError extends DomainError {
  public readonly code = 'SAME_ACCOUNT_POSTING';

  constructor(transactionId: string) {
    super(
      `double-entry posting for transaction ${transactionId} debits and credits the same account`,
    );
  }
}

export interface DoubleEntryPostingState {
  id: string;
  transactionId: string;
  debitAccount: LedgerAccountRef;
  creditAccount: LedgerAccountRef;
  money: MoneyProps;
  createdAt: Date;
}

export interface CreateDoubleEntryPostingProps {
  id: string;
  transactionId: string;
  debitAccount: LedgerAccountRef;
  creditAccount: LedgerAccountRef;
  money: Money;
  createdAt: Date;
}

export interface WalletMovementPostingProps {
  id: string;
  transactionId: string;
  walletId: string;
  providerId: string;
  direction: LedgerDirection;
  money: Money;
  createdAt: Date;
}

export class DoubleEntryPosting {
  private constructor(
    public readonly id: string,
    public readonly transactionId: string,
    public readonly debitAccount: LedgerAccountRef,
    public readonly creditAccount: LedgerAccountRef,
    public readonly money: Money,
    public readonly createdAt: Date,
  ) {}

  public static create(props: CreateDoubleEntryPostingProps): DoubleEntryPosting {
    if (sameAccount(props.debitAccount, props.creditAccount)) {
      throw new SameAccountPostingError(props.transactionId);
    }
    return new DoubleEntryPosting(
      props.id,
      props.transactionId,
      props.debitAccount,
      props.creditAccount,
      props.money,
      props.createdAt,
    );
  }

  public static forWalletMovement(props: WalletMovementPostingProps): DoubleEntryPosting {
    const walletAccount: LedgerAccountRef = {
      type: LedgerAccountType.PlayerWallet,
      referenceId: props.walletId,
    };
    const providerAccount: LedgerAccountRef = {
      type: LedgerAccountType.ProviderSettlement,
      referenceId: props.providerId,
    };
    const [debitAccount, creditAccount] =
      props.direction === LedgerDirection.Debit
        ? [walletAccount, providerAccount]
        : [providerAccount, walletAccount];

    return DoubleEntryPosting.create({
      id: props.id,
      transactionId: props.transactionId,
      debitAccount,
      creditAccount,
      money: props.money,
      createdAt: props.createdAt,
    });
  }

  public static rehydrate(state: DoubleEntryPostingState): DoubleEntryPosting {
    return new DoubleEntryPosting(
      state.id,
      state.transactionId,
      state.debitAccount,
      state.creditAccount,
      Money.from(state.money),
      state.createdAt,
    );
  }
}
