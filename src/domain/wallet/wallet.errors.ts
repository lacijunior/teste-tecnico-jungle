import { DomainError } from '../errors/domain-error.js';

export class InsufficientBalanceError extends DomainError {
  public readonly code = 'INSUFFICIENT_BALANCE';

  constructor(
    public readonly walletId: string,
    public readonly attemptedBalance: string,
  ) {
    super(`wallet ${walletId} would reach a negative balance of ${attemptedBalance}`);
  }
}

export class WalletCurrencyMismatchError extends DomainError {
  public readonly code = 'WALLET_CURRENCY_MISMATCH';

  constructor(walletId: string, walletCurrency: string, operationCurrency: string) {
    super(
      `wallet ${walletId} operates in ${walletCurrency} but received an operation in ${operationCurrency}`,
    );
  }
}
