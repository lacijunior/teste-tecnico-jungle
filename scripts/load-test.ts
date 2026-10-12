import { randomUUID } from 'node:crypto';

type SampleCategory =
  | 'success'
  | 'pending_reference'
  | 'business_rejection'
  | 'conflict'
  | 'client_error'
  | 'infrastructure_failure'
  | 'network_error';

interface RequestSample {
  category: SampleCategory;
  status: number;
  latencyMs: number;
}

function categorize(status: number): SampleCategory {
  if (status === 202) {
    return 'pending_reference';
  }
  if (status >= 200 && status < 300) {
    return 'success';
  }
  if (status === 409) {
    return 'conflict';
  }
  if (status === 422) {
    return 'business_rejection';
  }
  if (status >= 400 && status < 500) {
    return 'client_error';
  }
  return 'infrastructure_failure';
}

const baseUrl = process.env.LOAD_TEST_BASE_URL ?? 'http://localhost:3000';
const walletCount = Number.parseInt(process.env.LOAD_TEST_WALLETS ?? '20', 10);
const concurrency = Number.parseInt(process.env.LOAD_TEST_CONCURRENCY ?? '20', 10);
const totalRequests = Number.parseInt(process.env.LOAD_TEST_REQUESTS ?? '2000', 10);
const authTokenEndpoint =
  process.env.AUTH_TOKEN_ENDPOINT ??
  'http://localhost:8080/realms/wagering/protocol/openid-connect/token';

async function fetchAccessToken(): Promise<string> {
  const response = await fetch(authTokenEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'wagering-provider',
      client_secret: 'wagering-provider-secret',
    }),
  });
  if (!response.ok) {
    throw new Error(`failed to obtain access token: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

async function createWallet(accessToken: string): Promise<{ id: string; playerId: string }> {
  const playerId = randomUUID();
  const response = await fetch(`${baseUrl}/wallets`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ playerId, initialBalance: { amount: '1000000.00', currency: 'BRL' } }),
  });
  if (response.status !== 201) {
    throw new Error(`failed to create wallet: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { id: string };
  return { id: body.id, playerId };
}

async function fetchMetricsText(accessToken: string): Promise<string> {
  const response = await fetch(`${baseUrl}/metrics`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return response.text();
}

function extractCounter(metricsText: string, name: string): number {
  const match = metricsText
    .split('\n')
    .find((line) => line.startsWith(name) && !line.startsWith('#'));
  return match ? Number.parseFloat(match.split(' ').at(-1) ?? '0') : 0;
}

function extractHistogramSumAndCount(
  metricsText: string,
  name: string,
): { sum: number; count: number } {
  const sumLine = metricsText.split('\n').find((line) => line.startsWith(`${name}_sum`));
  const countLine = metricsText.split('\n').find((line) => line.startsWith(`${name}_count`));
  return {
    sum: sumLine ? Number.parseFloat(sumLine.split(' ').at(-1) ?? '0') : 0,
    count: countLine ? Number.parseFloat(countLine.split(' ').at(-1) ?? '0') : 0,
  };
}

function percentile(sortedLatencies: number[], p: number): number {
  if (sortedLatencies.length === 0) {
    return 0;
  }
  const index = Math.min(
    sortedLatencies.length - 1,
    Math.ceil((p / 100) * sortedLatencies.length) - 1,
  );
  return sortedLatencies[Math.max(index, 0)]!;
}

async function submitBet(
  accessToken: string,
  walletId: string,
  playerId: string,
  providerId: string,
): Promise<RequestSample> {
  const externalTransactionId = randomUUID();
  const start = performance.now();
  try {
    const response = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `${providerId}:${externalTransactionId}`,
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        providerId,
        externalTransactionId,
        playerId,
        walletId,
        roundId: 'load-test-round',
        gameId: 'load-test-game',
        kind: 'BET',
        money: { amount: '1.00', currency: 'BRL' },
      }),
    });
    await response.text();
    return {
      category: categorize(response.status),
      status: response.status,
      latencyMs: performance.now() - start,
    };
  } catch {
    return { category: 'network_error', status: 0, latencyMs: performance.now() - start };
  }
}

async function runWorker(
  accessToken: string,
  wallets: Array<{ id: string; playerId: string }>,
  providerId: string,
  remaining: { count: number },
  samples: RequestSample[],
): Promise<void> {
  while (remaining.count > 0) {
    remaining.count -= 1;
    const wallet = wallets[Math.floor(Math.random() * wallets.length)]!;
    samples.push(await submitBet(accessToken, wallet.id, wallet.playerId, providerId));
  }
}

async function main(): Promise<void> {
  console.log(`load test target: ${baseUrl}`);
  console.log('authenticating...');
  const accessToken = await fetchAccessToken();

  console.log(`creating ${walletCount} wallets...`);
  const wallets = await Promise.all(
    Array.from({ length: walletCount }, () => createWallet(accessToken)),
  );

  const providerId = `load-test-${randomUUID()}`;
  const beforeMetrics = await fetchMetricsText(accessToken);
  const lockConflictsBefore = extractCounter(beforeMetrics, 'wagering_wallet_lock_conflicts_total');
  const outboxLagBefore = extractHistogramSumAndCount(beforeMetrics, 'wagering_outbox_lag_seconds');

  const samples: RequestSample[] = [];
  const remaining = { count: totalRequests };
  const startedAt = performance.now();

  await Promise.all(
    Array.from({ length: concurrency }, () =>
      runWorker(accessToken, wallets, providerId, remaining, samples),
    ),
  );

  const durationSeconds = (performance.now() - startedAt) / 1000;

  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const afterMetrics = await fetchMetricsText(accessToken);
  const lockConflictsAfter = extractCounter(afterMetrics, 'wagering_wallet_lock_conflicts_total');
  const outboxLagAfter = extractHistogramSumAndCount(afterMetrics, 'wagering_outbox_lag_seconds');

  const latencies = samples.map((s) => s.latencyMs).sort((a, b) => a - b);
  const throughput = samples.length / durationSeconds;
  const byCategory = new Map<SampleCategory, number>();
  for (const sample of samples) {
    byCategory.set(sample.category, (byCategory.get(sample.category) ?? 0) + 1);
  }
  const countOf = (category: SampleCategory): number => byCategory.get(category) ?? 0;
  const infrastructureFailures = countOf('infrastructure_failure') + countOf('network_error');
  const outboxLagCountDelta = outboxLagAfter.count - outboxLagBefore.count;
  const outboxLagAvgMs =
    outboxLagCountDelta > 0
      ? ((outboxLagAfter.sum - outboxLagBefore.sum) / outboxLagCountDelta) * 1000
      : null;

  const report = `# Load test report

## Ambiente
- Alvo: ${baseUrl}
- Data: ${new Date().toISOString()}
- Wallets: ${walletCount}
- Concorrência (workers paralelos): ${concurrency}
- Total de requisições: ${samples.length}

## Metodologia
Cada worker sorteia uma wallet entre as ${walletCount} criadas e envia um BET de 1.00 BRL com
Idempotency-Key única, repetindo até o total de requisições configurado ser atingido. Sem meta de
RPS: o objetivo é observar comportamento sob carga concorrente real, não maximizar throughput bruto.

## Resultado
- Duração: ${durationSeconds.toFixed(2)}s
- Throughput: ${throughput.toFixed(1)} req/s
- Sucesso (2xx): ${countOf('success')} (${((countOf('success') / samples.length) * 100).toFixed(2)}%)
- Pendente de referência (202): ${countOf('pending_reference')}
- Rejeição de negócio (422): ${countOf('business_rejection')}
- Conflito (409): ${countOf('conflict')}
- Erro de cliente (4xx, exceto 409/422): ${countOf('client_error')}
- Falha de infraestrutura (5xx ou falha de rede): ${infrastructureFailures} (${((infrastructureFailures / samples.length) * 100).toFixed(2)}%)
- Latência p50: ${percentile(latencies, 50).toFixed(1)}ms
- Latência p95: ${percentile(latencies, 95).toFixed(1)}ms
- Latência p99: ${percentile(latencies, 99).toFixed(1)}ms
- Conflitos de optimistic lock durante o teste: ${lockConflictsAfter - lockConflictsBefore}
- Outbox lag médio durante o teste: ${outboxLagAvgMs === null ? 'sem amostras' : `${outboxLagAvgMs.toFixed(1)}ms`}

## Honestidade da análise
Este número de throughput depende inteiramente do hardware local, do número de wallets (mais
wallets = menos contenção) e da concorrência configurada — não é um benchmark de capacidade
máxima do sistema, apenas uma amostra reprodutível do comportamento sob a carga descrita acima.
`;

  console.log(report);
}

await main();
