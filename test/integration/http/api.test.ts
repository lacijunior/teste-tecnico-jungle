import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createTestHttpApp } from '../../support/test-http-app.js';
import { fetchProviderAccessToken } from '../../support/auth-token.js';
import { WalletLockRetryPolicy } from '../../../src/application/wallet/wallet-lock-retry-policy.js';
import { PromWageringMetrics } from '../../../src/infrastructure/observability/prom-wagering-metrics.js';

describe('HTTP API (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let authHeaders: Record<string, string>;

  beforeAll(async () => {
    const context = await createTestHttpApp();
    app = context.app;
    baseUrl = context.baseUrl;
    const token = await fetchProviderAccessToken();
    authHeaders = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live requires no authentication and always returns ok', async () => {
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready requires no authentication and reports database and messaging checks', async () => {
    const response = await fetch(`${baseUrl}/health/ready`);
    const body = (await response.json()) as { status: string; checks: Record<string, boolean> };
    expect(response.status).toBe(200);
    expect(body.checks.database).toBe(true);
    expect(body.checks.messaging).toBe(true);
  });

  it('GET /metrics requires authentication like any other business endpoint', async () => {
    const unauthenticated = await fetch(`${baseUrl}/metrics`);
    expect(unauthenticated.status).toBe(401);

    const response = await fetch(`${baseUrl}/metrics`, { headers: authHeaders });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('wagering_transactions_total');
  });

  it('rejects a business endpoint call without a bearer token', async () => {
    const response = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerId: randomUUID(),
        initialBalance: { amount: '10.00', currency: 'BRL' },
      }),
    });
    expect(response.status).toBe(401);
  });

  it('rejects a business endpoint call with an invalid bearer token', async () => {
    const response = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-real-token' },
      body: JSON.stringify({
        playerId: randomUUID(),
        initialBalance: { amount: '10.00', currency: 'BRL' },
      }),
    });
    expect(response.status).toBe(401);
  });

  it('POST /wallets creates a wallet and rejects a duplicate as a conflict', async () => {
    const playerId = randomUUID();
    const createResponse = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    expect(createResponse.status).toBe(201);
    const wallet = (await createResponse.json()) as { id: string; balance: { amount: string } };
    expect(wallet.balance.amount).toBe('100.00');

    const duplicateResponse = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ playerId, initialBalance: { amount: '0.00', currency: 'BRL' } }),
    });
    expect(duplicateResponse.status).toBe(409);
  });

  it('GET /wallets/:walletId returns 404 for an unknown wallet', async () => {
    const response = await fetch(`${baseUrl}/wallets/${randomUUID()}`, { headers: authHeaders });
    expect(response.status).toBe(404);
  });

  it('POST /wagering/transactions requires the Idempotency-Key header', async () => {
    const response = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it('submits a BET end-to-end over HTTP and replays it idempotently', async () => {
    const playerId = randomUUID();
    const createResponse = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const wallet = (await createResponse.json()) as { id: string };
    const providerId = `http-${randomUUID()}`;
    const payload = {
      providerId,
      externalTransactionId: 'ext-1',
      playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    };

    const firstResponse = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { ...authHeaders, 'idempotency-key': `${providerId}:ext-1` },
      body: JSON.stringify(payload),
    });
    const first = (await firstResponse.json()) as { status: string; idempotentReplay: boolean };
    expect(firstResponse.status).toBe(201);
    expect(first.status).toBe('PROCESSED');
    expect(first.idempotentReplay).toBe(false);

    const secondResponse = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { ...authHeaders, 'idempotency-key': `${providerId}:ext-1` },
      body: JSON.stringify(payload),
    });
    const second = (await secondResponse.json()) as { idempotentReplay: boolean };
    expect(secondResponse.status).toBe(200);
    expect(second.idempotentReplay).toBe(true);
  });

  it('returns 409 when the same provider+externalTransactionId is claimed under a different Idempotency-Key', async () => {
    const playerId = randomUUID();
    const createResponse = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const wallet = (await createResponse.json()) as { id: string };
    const providerId = `http-${randomUUID()}`;
    const payload = {
      providerId,
      externalTransactionId: 'ext-1',
      playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    };

    await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { ...authHeaders, 'idempotency-key': `${providerId}:ext-1` },
      body: JSON.stringify(payload),
    });

    const response = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { ...authHeaders, 'idempotency-key': `${providerId}:a-different-key` },
      body: JSON.stringify(payload),
    });
    expect(response.status).toBe(409);
  });

  it('returns 422 for a business rejection such as insufficient funds', async () => {
    const playerId = randomUUID();
    const createResponse = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ playerId, initialBalance: { amount: '5.00', currency: 'BRL' } }),
    });
    const wallet = (await createResponse.json()) as { id: string };
    const providerId = `http-${randomUUID()}`;

    const response = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { ...authHeaders, 'idempotency-key': `${providerId}:ext-1` },
      body: JSON.stringify({
        providerId,
        externalTransactionId: 'ext-1',
        playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: 'BET',
        money: { amount: '50.00', currency: 'BRL' },
      }),
    });
    const body = (await response.json()) as { status: string; failureCode: string };
    expect(response.status).toBe(422);
    expect(body.status).toBe('REJECTED');
    expect(body.failureCode).toBe('INSUFFICIENT_FUNDS');
  });

  it('returns 422 for a currency mismatch instead of an unhandled 400', async () => {
    const playerId = randomUUID();
    const createResponse = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const wallet = (await createResponse.json()) as { id: string };
    const providerId = `http-${randomUUID()}`;

    const response = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { ...authHeaders, 'idempotency-key': `${providerId}:ext-1` },
      body: JSON.stringify({
        providerId,
        externalTransactionId: 'ext-1',
        playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: 'BET',
        money: { amount: '10.00', currency: 'USD' },
      }),
    });
    const body = (await response.json()) as { status: string; failureCode: string };
    expect(response.status).toBe(422);
    expect(body.status).toBe('REJECTED');
    expect(body.failureCode).toBe('CURRENCY_MISMATCH');
  });

  it('returns 202 for a REFUND left PENDING_REFERENCE because its BET has not arrived yet', async () => {
    const playerId = randomUUID();
    const createResponse = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const wallet = (await createResponse.json()) as { id: string };
    const providerId = `http-${randomUUID()}`;

    const response = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { ...authHeaders, 'idempotency-key': `${providerId}:ext-refund-1` },
      body: JSON.stringify({
        providerId,
        externalTransactionId: 'ext-refund-1',
        playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: 'REFUND',
        referenceExternalTransactionId: 'ext-bet-1',
        money: { amount: '25.00', currency: 'BRL' },
      }),
    });
    const body = (await response.json()) as { status: string };
    expect(response.status).toBe(202);
    expect(body.status).toBe('PENDING_REFERENCE');
  });

  it('keeps returning 202 on an idempotent replay of a transaction still PENDING_REFERENCE', async () => {
    const playerId = randomUUID();
    const createResponse = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const wallet = (await createResponse.json()) as { id: string };
    const providerId = `http-${randomUUID()}`;
    const payload = {
      providerId,
      externalTransactionId: 'ext-refund-pending',
      playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: 'REFUND',
      referenceExternalTransactionId: 'ext-bet-pending',
      money: { amount: '25.00', currency: 'BRL' },
    };

    const first = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { ...authHeaders, 'idempotency-key': `${providerId}:ext-refund-pending` },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(202);

    const second = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { ...authHeaders, 'idempotency-key': `${providerId}:ext-refund-pending` },
      body: JSON.stringify(payload),
    });
    const secondBody = (await second.json()) as { status: string; idempotentReplay: boolean };
    expect(second.status).toBe(202);
    expect(secondBody.status).toBe('PENDING_REFERENCE');
    expect(secondBody.idempotentReplay).toBe(true);
  });

  it('GET /wagering/transactions/:transactionId returns the stored transaction', async () => {
    const playerId = randomUUID();
    const createResponse = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const wallet = (await createResponse.json()) as { id: string };
    const providerId = `http-${randomUUID()}`;

    const submitResponse = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { ...authHeaders, 'idempotency-key': `${providerId}:ext-1` },
      body: JSON.stringify({
        providerId,
        externalTransactionId: 'ext-1',
        playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: 'BET',
        money: { amount: '10.00', currency: 'BRL' },
      }),
    });
    const submitted = (await submitResponse.json()) as { transactionId: string };

    const response = await fetch(`${baseUrl}/wagering/transactions/${submitted.transactionId}`, {
      headers: authHeaders,
    });
    const body = (await response.json()) as { transactionId: string; providerId: string };
    expect(response.status).toBe(200);
    expect(body.transactionId).toBe(submitted.transactionId);
    expect(body.providerId).toBe(providerId);
  });

  it('GET /wagering/transactions/:transactionId returns 404 for an unknown transaction', async () => {
    const response = await fetch(`${baseUrl}/wagering/transactions/${randomUUID()}`, {
      headers: authHeaders,
    });
    expect(response.status).toBe(404);
  });

  it('GET /providers/:providerId/wagering/transactions/:externalTransactionId returns the stored transaction', async () => {
    const playerId = randomUUID();
    const createResponse = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const wallet = (await createResponse.json()) as { id: string };
    const providerId = `http-${randomUUID()}`;

    const submitResponse = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: { ...authHeaders, 'idempotency-key': `${providerId}:ext-lookup` },
      body: JSON.stringify({
        providerId,
        externalTransactionId: 'ext-lookup',
        playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: 'BET',
        money: { amount: '10.00', currency: 'BRL' },
      }),
    });
    const submitted = (await submitResponse.json()) as { transactionId: string };

    const response = await fetch(
      `${baseUrl}/providers/${providerId}/wagering/transactions/ext-lookup`,
      { headers: authHeaders },
    );
    const body = (await response.json()) as { transactionId: string };
    expect(response.status).toBe(200);
    expect(body.transactionId).toBe(submitted.transactionId);
  });

  it('GET /providers/:providerId/wagering/transactions/:externalTransactionId returns 404 when unknown', async () => {
    const response = await fetch(
      `${baseUrl}/providers/${randomUUID()}/wagering/transactions/does-not-exist`,
      { headers: authHeaders },
    );
    expect(response.status).toBe(404);
  });

  it('GET /wallets/:walletId/ledger returns the ledger entries for the wallet', async () => {
    const playerId = randomUUID();
    const createResponse = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const wallet = (await createResponse.json()) as { id: string };

    const response = await fetch(`${baseUrl}/wallets/${wallet.id}/ledger`, {
      headers: authHeaders,
    });
    const body = (await response.json()) as { entries: Array<{ id: string }> };
    expect(response.status).toBe(200);
    expect(body.entries).toHaveLength(1);
  });

  it('GET /wallets/:walletId/ledger returns 400 for a malformed cursor', async () => {
    const playerId = randomUUID();
    const createResponse = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const wallet = (await createResponse.json()) as { id: string };

    const response = await fetch(
      `${baseUrl}/wallets/${wallet.id}/ledger?cursor=not-a-valid-cursor`,
      { headers: authHeaders },
    );
    expect(response.status).toBe(400);
  });

  it('POST /wallets/:walletId/reconciliation reports a consistent balance', async () => {
    const playerId = randomUUID();
    const createResponse = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ playerId, initialBalance: { amount: '100.00', currency: 'BRL' } }),
    });
    const wallet = (await createResponse.json()) as { id: string };

    const response = await fetch(`${baseUrl}/wallets/${wallet.id}/reconciliation`, {
      method: 'POST',
      headers: authHeaders,
    });
    const body = (await response.json()) as { consistent: boolean };
    expect(response.status).toBe(200);
    expect(body.consistent).toBe(true);
  });
});

describe('HTTP API (integration) - infrastructure failure', () => {
  let app: INestApplication;
  let baseUrl: string;
  let authHeaders: Record<string, string>;

  beforeAll(async () => {
    const context = await createTestHttpApp((builder) =>
      builder
        .overrideProvider(WalletLockRetryPolicy)
        .useValue(
          new WalletLockRetryPolicy({ maxAttempts: 1, baseDelayMs: 1 }, new PromWageringMetrics()),
        ),
    );
    app = context.app;
    baseUrl = context.baseUrl;
    const token = await fetchProviderAccessToken();
    authHeaders = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 503 for a transaction marked FAILED after exhausting wallet lock retries', async () => {
    const playerId = randomUUID();
    const createResponse = await fetch(`${baseUrl}/wallets`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ playerId, initialBalance: { amount: '1000.00', currency: 'BRL' } }),
    });
    const wallet = (await createResponse.json()) as { id: string };
    const providerId = `http-infra-failure-${randomUUID()}`;

    const responses = await Promise.all(
      Array.from({ length: 15 }, (_, index) =>
        fetch(`${baseUrl}/wagering/transactions`, {
          method: 'POST',
          headers: { ...authHeaders, 'idempotency-key': `${providerId}:ext-${index}` },
          body: JSON.stringify({
            providerId,
            externalTransactionId: `ext-${index}`,
            playerId,
            walletId: wallet.id,
            roundId: 'round-1',
            gameId: 'fortune-chimp',
            kind: 'BET',
            money: { amount: '10.00', currency: 'BRL' },
          }),
        }),
      ),
    );
    const statuses = responses.map((r) => r.status);

    expect(statuses).toContain(503);
  }, 15_000);
});
