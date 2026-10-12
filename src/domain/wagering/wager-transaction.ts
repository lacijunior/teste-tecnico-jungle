import { LedgerDirection } from '../wallet/ledger-direction.js';
import { Money, type MoneyProps } from '../money/money.js';
import type { FailureCode } from './failure-code.js';
import { WagerTransactionKind } from './wager-transaction-kind.js';
import { TERMINAL_STATUSES, WagerTransactionStatus } from './wager-transaction-status.js';
import {
  InvalidTransactionStateError,
  LedgerDirectionUndefinedError,
  MissingReferenceError,
  RollbackWithoutReferenceError,
  UnexpectedReferenceError,
  UnsupportedWagerTransactionKindError,
} from './wagering.errors.js';

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId: string | undefined;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId: string | undefined;
  failureCode: FailureCode | undefined;
  processedAt: Date | undefined;
  pendingReferenceAttempts: number;
  nextReferenceAttemptAt: Date | undefined;
  balanceSnapshot: MoneyProps | undefined;
}

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
}

const REFERENCE_REQUIRING_KINDS: ReadonlySet<WagerTransactionKind> = new Set([
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
]);

// WIN may optionally carry a reference back to the BET of the same round, for traceability —
// it never changes the ledger direction (always CREDIT) or requires cross-validation like
// REFUND/ROLLBACK do.
const REFERENCE_ALLOWING_KINDS: ReadonlySet<WagerTransactionKind> = new Set([
  ...REFERENCE_REQUIRING_KINDS,
  WagerTransactionKind.Win,
]);

export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId: string | undefined,
    private _failureCode: FailureCode | undefined,
    private _processedAt: Date | undefined,
    private _pendingReferenceAttempts: number,
    private _nextReferenceAttemptAt: Date | undefined,
    private _balanceSnapshot: Money | undefined,
  ) {}

  public static create(props: CreateWagerTransactionProps): WagerTransaction {
    const requiresReference = REFERENCE_REQUIRING_KINDS.has(props.kind);
    if (requiresReference && !props.referenceExternalTransactionId) {
      throw new MissingReferenceError(props.kind);
    }
    if (!REFERENCE_ALLOWING_KINDS.has(props.kind) && props.referenceExternalTransactionId) {
      throw new UnexpectedReferenceError(props.kind);
    }
    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt,
      WagerTransactionStatus.Pending,
      undefined,
      undefined,
      undefined,
      0,
      undefined,
      undefined,
    );
  }

  public static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      Money.from(state.money),
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
      state.pendingReferenceAttempts,
      state.nextReferenceAttemptAt,
      state.balanceSnapshot ? Money.from(state.balanceSnapshot) : undefined,
    );
  }

  public get status(): WagerTransactionStatus {
    return this._status;
  }

  public get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  public get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  public get processedAt(): Date | undefined {
    return this._processedAt;
  }

  public get pendingReferenceAttempts(): number {
    return this._pendingReferenceAttempts;
  }

  public get nextReferenceAttemptAt(): Date | undefined {
    return this._nextReferenceAttemptAt;
  }

  public get balanceSnapshot(): Money | undefined {
    return this._balanceSnapshot;
  }

  public markProcessed(
    referenceTransactionId: string | undefined,
    at: Date,
    balanceSnapshot: Money,
  ): void {
    this.assertNotTerminal(WagerTransactionStatus.Processed);
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
    this._balanceSnapshot = balanceSnapshot;
  }

  public markPendingReference(balanceSnapshot: Money): void {
    this.assertNotTerminal(WagerTransactionStatus.PendingReference);
    this._status = WagerTransactionStatus.PendingReference;
    this._balanceSnapshot = balanceSnapshot;
  }

  public reject(code: FailureCode, balanceSnapshot: Money): void {
    this.assertNotTerminal(WagerTransactionStatus.Rejected);
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._balanceSnapshot = balanceSnapshot;
  }

  public fail(code: FailureCode, balanceSnapshot: Money): void {
    this.assertNotTerminal(WagerTransactionStatus.Failed);
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._balanceSnapshot = balanceSnapshot;
  }

  public scheduleReferenceRetry(nextAttemptAt: Date): void {
    if (this._status !== WagerTransactionStatus.PendingReference) {
      throw new InvalidTransactionStateError(this.id, this._status, 'RETRY_SCHEDULED');
    }
    this._pendingReferenceAttempts += 1;
    this._nextReferenceAttemptAt = nextAttemptAt;
  }

  public isTerminal(): boolean {
    return TERMINAL_STATUSES.has(this._status);
  }

  public affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  public requiresReference(): boolean {
    return REFERENCE_REQUIRING_KINDS.has(this.kind);
  }

  public matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  public ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Loss:
        throw new LedgerDirectionUndefinedError(this.id);
      case WagerTransactionKind.Rollback: {
        if (!reference) {
          throw new RollbackWithoutReferenceError(this.id);
        }
        const referenceDirection = reference.ledgerDirectionFor();
        return referenceDirection === LedgerDirection.Debit
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;
      }
      default:
        throw new UnsupportedWagerTransactionKindError(this.id, String(this.kind));
    }
  }

  private assertNotTerminal(attempted: WagerTransactionStatus): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this.id, this._status, attempted);
    }
  }
}
