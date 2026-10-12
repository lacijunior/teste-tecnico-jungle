import { Injectable } from '@nestjs/common';
import type { WageringMetrics } from '../../application/ports/wagering-metrics.js';
import {
  idempotentReplaysTotal,
  reconciliationDivergencesTotal,
  submitTransactionDurationSeconds,
  wagerTransactionsTotal,
  walletLockConflictsTotal,
} from './metrics.js';

@Injectable()
export class PromWageringMetrics implements WageringMetrics {
  public recordTransactionOutcome(status: string): void {
    wagerTransactionsTotal.inc({ status });
  }

  public recordIdempotentReplay(): void {
    idempotentReplaysTotal.inc();
  }

  public observeSubmitDurationSeconds(seconds: number): void {
    submitTransactionDurationSeconds.observe(seconds);
  }

  public recordWalletLockConflict(): void {
    walletLockConflictsTotal.inc();
  }

  public recordReconciliationDivergence(): void {
    reconciliationDivergencesTotal.inc();
  }
}
