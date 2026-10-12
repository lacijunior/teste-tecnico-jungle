import { OptimisticLockError } from '@mikro-orm/core';
import type { WageringMetrics } from '../ports/wagering-metrics.js';

export class WalletLockRetryExhaustedError extends Error {
  constructor(attempts: number) {
    super(`exhausted ${attempts} attempts to acquire the wallet optimistic lock`);
  }
}

export interface WalletLockRetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
}

export class WalletLockRetryPolicy {
  constructor(
    private readonly options: WalletLockRetryOptions,
    private readonly metrics: WageringMetrics,
  ) {}

  public async run<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof OptimisticLockError)) {
          throw error;
        }
        this.metrics.recordWalletLockConflict();
        attempt += 1;
        if (attempt >= this.options.maxAttempts) {
          throw new WalletLockRetryExhaustedError(attempt);
        }
        await sleep(this.options.baseDelayMs * attempt);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
