export interface WageringMetrics {
  recordTransactionOutcome(status: string): void;
  recordIdempotentReplay(): void;
  observeSubmitDurationSeconds(seconds: number): void;
  recordWalletLockConflict(): void;
  recordReconciliationDivergence(): void;
}

export const WAGERING_METRICS = Symbol('WAGERING_METRICS');
