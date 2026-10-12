process.env.AWS_REGION ??= 'us-east-1';
process.env.AWS_ENDPOINT_URL ??= 'http://localhost:4566';
process.env.AWS_ACCESS_KEY_ID ??= 'test';
process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
process.env.SQS_WAGER_QUEUE_URL ??= 'http://localhost:4566/000000000000/wager-transactions.fifo';
process.env.SQS_WAGER_DLQ_URL ??= 'http://localhost:4566/000000000000/wager-transactions-dlq.fifo';
process.env.SQS_EVENTS_QUEUE_URL ??=
  'http://localhost:4566/000000000000/wagering-domain-events.fifo';
process.env.AUTH_ISSUER_URL ??= 'http://localhost:8080/realms/wagering';

// Forced (not `??=`): these must never be inherited from a developer's local `.env`, which Bun
// loads automatically before this file runs and which may carry production-style values for
// local manual testing (a different, slower polling/retry tuning, and — critically —
// DATABASE_URL pointing at the dev database instead of the isolated test one).
process.env.DATABASE_URL = 'postgresql://wagering:wagering@localhost:5432/wagering_test';
process.env.WALLET_LOCK_MAX_RETRIES = '10';
process.env.WALLET_LOCK_RETRY_BASE_DELAY_MS = '10';
process.env.PENDING_REFERENCE_POLL_INTERVAL_MS = '200';
process.env.PENDING_REFERENCE_MAX_ATTEMPTS = '2';
process.env.PENDING_REFERENCE_TTL_HOURS = '24';
process.env.OUTBOX_POLL_INTERVAL_MS = '200';
process.env.OUTBOX_PUBLISH_BATCH_SIZE = '20';
process.env.OUTBOX_CLAIM_LEASE_MS = '1000';
