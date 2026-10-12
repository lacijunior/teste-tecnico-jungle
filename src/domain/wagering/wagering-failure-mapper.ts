import { InsufficientBalanceError, WalletCurrencyMismatchError } from '../wallet/wallet.errors.js';
import { FailureCode } from './failure-code.js';
import {
  ReferenceAlreadyReversedError,
  ReferenceAmountMismatchError,
  ReferenceScopeMismatchError,
  ReferenceTypeInvalidError,
} from './wagering.errors.js';

export function mapReferenceErrorToFailureCode(error: unknown): FailureCode | undefined {
  if (error instanceof ReferenceScopeMismatchError) {
    return FailureCode.ReferenceScopeMismatch;
  }
  if (error instanceof ReferenceTypeInvalidError) {
    return FailureCode.ReferenceTypeInvalid;
  }
  if (error instanceof ReferenceAmountMismatchError) {
    return FailureCode.ReferenceAmountMismatch;
  }
  if (error instanceof ReferenceAlreadyReversedError) {
    return FailureCode.ReferenceAlreadyReversed;
  }
  return undefined;
}

export function mapWalletMutationErrorToFailureCode(
  error: unknown,
  isReversal: boolean,
): FailureCode | undefined {
  if (error instanceof InsufficientBalanceError) {
    return isReversal ? FailureCode.NegativeBalanceOnReversal : FailureCode.InsufficientFunds;
  }
  if (error instanceof WalletCurrencyMismatchError) {
    return FailureCode.CurrencyMismatch;
  }
  return undefined;
}
