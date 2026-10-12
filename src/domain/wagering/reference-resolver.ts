import type { Money } from '../money/money.js';
import { WagerTransactionKind } from './wager-transaction-kind.js';
import type { WagerTransaction } from './wager-transaction.js';
import {
  ReferenceAlreadyReversedError,
  ReferenceAmountMismatchError,
  ReferenceScopeMismatchError,
  ReferenceTypeInvalidError,
} from './wagering.errors.js';

export interface ReferenceScope {
  providerId: string;
  playerId: string;
  walletId: string;
  currency: string;
  roundId: string;
}

export interface EnsureValidReferenceParams {
  reversingKind: WagerTransactionKind.Refund | WagerTransactionKind.Rollback;
  reference: WagerTransaction;
  scope: ReferenceScope;
  expectedMoney: Money;
  alreadyReversed: boolean;
}

const ALLOWED_REFERENCE_KINDS: Record<string, ReadonlyArray<WagerTransactionKind>> = {
  [WagerTransactionKind.Refund]: [WagerTransactionKind.Bet],
  [WagerTransactionKind.Rollback]: [
    WagerTransactionKind.Bet,
    WagerTransactionKind.Win,
    WagerTransactionKind.Refund,
  ],
};

export class ReferenceResolver {
  public static ensureValid(params: EnsureValidReferenceParams): void {
    const { reversingKind, reference, scope, expectedMoney, alreadyReversed } = params;

    if (
      reference.providerId !== scope.providerId ||
      reference.playerId !== scope.playerId ||
      reference.walletId !== scope.walletId ||
      reference.roundId !== scope.roundId ||
      reference.money.currency !== scope.currency
    ) {
      throw new ReferenceScopeMismatchError(reference.id);
    }

    if (!ALLOWED_REFERENCE_KINDS[reversingKind]?.includes(reference.kind)) {
      throw new ReferenceTypeInvalidError(reversingKind, reference.kind);
    }

    if (!reference.money.equals(expectedMoney)) {
      throw new ReferenceAmountMismatchError(reference.id);
    }

    if (alreadyReversed) {
      throw new ReferenceAlreadyReversedError(reference.id);
    }
  }
}
