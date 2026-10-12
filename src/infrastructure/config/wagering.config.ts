function int(name: string, fallback: number): number {
  const raw = process.env[name];
  return raw ? Number.parseInt(raw, 10) : fallback;
}

export const walletLockConfig = {
  maxAttempts: int('WALLET_LOCK_MAX_RETRIES', 5),
  baseDelayMs: int('WALLET_LOCK_RETRY_BASE_DELAY_MS', 20),
};

export const outboxConfig = {
  pollIntervalMs: int('OUTBOX_POLL_INTERVAL_MS', 1_000),
  publishBatchSize: int('OUTBOX_PUBLISH_BATCH_SIZE', 20),
  claimLeaseMs: int('OUTBOX_CLAIM_LEASE_MS', 30_000),
};

export const pendingReferenceConfig = {
  pollIntervalMs: int('PENDING_REFERENCE_POLL_INTERVAL_MS', 5_000),
  maxAttempts: int('PENDING_REFERENCE_MAX_ATTEMPTS', 15),
  ttlHours: int('PENDING_REFERENCE_TTL_HOURS', 24),
};

export const sqsConfig = {
  region: process.env.AWS_REGION ?? 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT_URL,
  queueUrl: process.env.SQS_WAGER_QUEUE_URL ?? '',
  dlqUrl: process.env.SQS_WAGER_DLQ_URL ?? '',
  eventsQueueUrl: process.env.SQS_EVENTS_QUEUE_URL ?? '',
  maxReceiveCount: int('SQS_CONSUMER_MAX_RECEIVE_COUNT', 5),
};

const authIssuerUrl = process.env.AUTH_ISSUER_URL ?? 'http://localhost:8080/realms/wagering';

export const authConfig = {
  issuerUrl: authIssuerUrl,
  jwksUrl: `${authIssuerUrl}/protocol/openid-connect/certs`,
};
