import { DomainError } from '../errors/domain-error.js';
import type { WagerTransactionStatus } from './wager-transaction-status.js';

export class InvalidTransactionStateError extends DomainError {
  public readonly code = 'INVALID_TRANSACTION_STATE';

  constructor(transactionId: string, from: WagerTransactionStatus, attempted: string) {
    super(`transaction ${transactionId} is terminal at ${from}, cannot transition to ${attempted}`);
  }
}

export class MissingReferenceError extends DomainError {
  public readonly code = 'MISSING_REFERENCE';

  constructor(kind: string) {
    super(`${kind} requires a referenceExternalTransactionId`);
  }
}

export class UnexpectedReferenceError extends DomainError {
  public readonly code = 'UNEXPECTED_REFERENCE';

  constructor(kind: string) {
    super(`${kind} must not carry a referenceExternalTransactionId`);
  }
}

export class LedgerDirectionUndefinedError extends DomainError {
  public readonly code = 'LEDGER_DIRECTION_UNDEFINED';

  constructor(transactionId: string) {
    super(`transaction ${transactionId} does not affect the wallet balance`);
  }
}

export class RollbackWithoutReferenceError extends DomainError {
  public readonly code = 'ROLLBACK_WITHOUT_REFERENCE';

  constructor(transactionId: string) {
    super(`rollback ${transactionId} cannot resolve a ledger direction without its reference`);
  }
}

export class ReferenceScopeMismatchError extends DomainError {
  public readonly code = 'REFERENCE_SCOPE_MISMATCH';

  constructor(referenceTransactionId: string) {
    super(
      `reference ${referenceTransactionId} does not belong to the same provider, player, wallet, currency and round`,
    );
  }
}

export class ReferenceTypeInvalidError extends DomainError {
  public readonly code = 'REFERENCE_TYPE_INVALID';

  constructor(reversingKind: string, referenceKind: string) {
    super(`${reversingKind} cannot reference a transaction of kind ${referenceKind}`);
  }
}

export class ReferenceAmountMismatchError extends DomainError {
  public readonly code = 'REFERENCE_AMOUNT_MISMATCH';

  constructor(referenceTransactionId: string) {
    super(`amount does not match the referenced transaction ${referenceTransactionId}`);
  }
}

export class ReferenceAlreadyReversedError extends DomainError {
  public readonly code = 'REFERENCE_ALREADY_REVERSED';

  constructor(referenceTransactionId: string) {
    super(`reference ${referenceTransactionId} was already reversed by this operation type`);
  }
}

export class UnsupportedWagerTransactionKindError extends DomainError {
  public readonly code = 'UNSUPPORTED_WAGER_TRANSACTION_KIND';

  constructor(transactionId: string, kind: string) {
    super(`transaction ${transactionId} has an unsupported kind: ${kind}`);
  }
}
