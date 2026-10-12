import { Counter, Histogram, Registry } from 'prom-client';

export const metricsRegistry = new Registry();

export const wagerTransactionsTotal = new Counter({
  name: 'wagering_transactions_total',
  help: 'Wager transactions processed, by final status',
  labelNames: ['status'],
  registers: [metricsRegistry],
});

export const idempotentReplaysTotal = new Counter({
  name: 'wagering_idempotent_replays_total',
  help: 'Requests resolved as an idempotent replay instead of a new submission',
  registers: [metricsRegistry],
});

export const walletLockConflictsTotal = new Counter({
  name: 'wagering_wallet_lock_conflicts_total',
  help: 'Optimistic lock conflicts detected while updating a wallet',
  registers: [metricsRegistry],
});

export const submitTransactionDurationSeconds = new Histogram({
  name: 'wagering_submit_transaction_duration_seconds',
  help: 'Latency of SubmitWagerTransactionUseCase.execute',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

export const outboxPublishedTotal = new Counter({
  name: 'wagering_outbox_published_total',
  help: 'Outbox messages successfully published',
  registers: [metricsRegistry],
});

export const outboxPublishRetriesTotal = new Counter({
  name: 'wagering_outbox_publish_retries_total',
  help: 'Outbox messages that failed to publish and were scheduled for retry',
  registers: [metricsRegistry],
});

export const outboxLagSeconds = new Histogram({
  name: 'wagering_outbox_lag_seconds',
  help: 'Time between an outbox message occurring and being published',
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [metricsRegistry],
});

export const sqsDuplicatesDetectedTotal = new Counter({
  name: 'wagering_sqs_duplicates_detected_total',
  help: 'SQS messages recognized as already processed via the inbox',
  registers: [metricsRegistry],
});

export const sqsMessageFailuresTotal = new Counter({
  name: 'wagering_sqs_message_failures_total',
  help: 'SQS message processing failures, by whether retrying can ever succeed',
  labelNames: ['kind'],
  registers: [metricsRegistry],
});

export const reconciliationDivergencesTotal = new Counter({
  name: 'wagering_reconciliation_divergences_total',
  help: 'Reconciliation checks that found a mismatch between stored and calculated balance',
  registers: [metricsRegistry],
});
