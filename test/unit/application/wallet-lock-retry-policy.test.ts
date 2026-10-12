import { describe, expect, it } from 'bun:test';
import { OptimisticLockError } from '@mikro-orm/core';
import type { WageringMetrics } from '../../../src/application/ports/wagering-metrics.js';
import {
  WalletLockRetryExhaustedError,
  WalletLockRetryPolicy,
} from '../../../src/application/wallet/wallet-lock-retry-policy.js';

function buildMetricsSpy(): WageringMetrics & { walletLockConflicts: number } {
  return {
    walletLockConflicts: 0,
    recordTransactionOutcome: () => undefined,
    recordIdempotentReplay: () => undefined,
    observeSubmitDurationSeconds: () => undefined,
    recordWalletLockConflict() {
      this.walletLockConflicts += 1;
    },
    recordReconciliationDivergence: () => undefined,
  };
}

describe('WalletLockRetryPolicy', () => {
  it('returns the result on the first successful attempt', async () => {
    const policy = new WalletLockRetryPolicy({ maxAttempts: 3, baseDelayMs: 1 }, buildMetricsSpy());

    const result = await policy.run(async () => 'ok');

    expect(result).toBe('ok');
  });

  it('retries after an optimistic lock conflict and eventually succeeds', async () => {
    const metrics = buildMetricsSpy();
    const policy = new WalletLockRetryPolicy({ maxAttempts: 5, baseDelayMs: 1 }, metrics);
    let calls = 0;

    const result = await policy.run(async () => {
      calls += 1;
      if (calls < 3) {
        throw OptimisticLockError.lockFailed('wallet-1');
      }
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(metrics.walletLockConflicts).toBe(2);
  });

  it('gives up after exhausting the configured attempts', async () => {
    const metrics = buildMetricsSpy();
    const policy = new WalletLockRetryPolicy({ maxAttempts: 2, baseDelayMs: 1 }, metrics);
    let calls = 0;

    await expect(
      policy.run(async () => {
        calls += 1;
        throw OptimisticLockError.lockFailed('wallet-1');
      }),
    ).rejects.toThrow(WalletLockRetryExhaustedError);
    expect(calls).toBe(2);
    expect(metrics.walletLockConflicts).toBe(2);
  });

  it('propagates any other error without retrying', async () => {
    const policy = new WalletLockRetryPolicy({ maxAttempts: 5, baseDelayMs: 1 }, buildMetricsSpy());
    let calls = 0;

    await expect(
      policy.run(async () => {
        calls += 1;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });
});
