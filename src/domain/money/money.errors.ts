import { DomainError } from '../errors/domain-error.js';

export class InvalidMoneyAmountError extends DomainError {
  public readonly code = 'INVALID_MONEY_AMOUNT';

  constructor(rawAmount: string) {
    super(`"${rawAmount}" is not a valid monetary amount with scale 2`);
  }
}

export class InvalidCurrencyError extends DomainError {
  public readonly code = 'INVALID_CURRENCY';

  constructor(rawCurrency: string) {
    super(`"${rawCurrency}" is not a valid ISO-4217 currency code`);
  }
}

export class CurrencyMismatchError extends DomainError {
  public readonly code = 'CURRENCY_MISMATCH';

  constructor(expected: string, actual: string) {
    super(`expected currency "${expected}" but got "${actual}"`);
  }
}
