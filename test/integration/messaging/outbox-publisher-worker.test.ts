import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import type { SQSClient } from '@aws-sdk/client-sqs';
import {
  DeleteMessageCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { Money } from '../../../src/domain/money/money.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';
import { CreateWalletUseCase } from '../../../src/application/wallet/create-wallet.use-case.js';
import { SubmitWagerTransactionUseCase } from '../../../src/application/wagering/submit-wager-transaction.use-case.js';
import { SQS_CLIENT } from '../../../src/infrastructure/messaging/sqs/sqs.tokens.js';
import { sqsConfig } from '../../../src/infrastructure/config/wagering.config.js';
import { createFullTestApp } from '../../support/test-app.js';
import { waitFor } from '../../support/wait-for.js';

async function drainQueue(
  client: SQSClient,
  maxBatches = 10,
): Promise<Array<{ eventId: string; eventType: string }>> {
  const collected: Array<{ eventId: string; eventType: string }> = [];
  for (let i = 0; i < maxBatches; i += 1) {
    const response = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: sqsConfig.eventsQueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
      }),
    );
    if (!response.Messages || response.Messages.length === 0) {
      break;
    }
    for (const message of response.Messages) {
      if (message.Body) {
        const parsed = JSON.parse(message.Body) as { eventId: string; eventType: string };
        collected.push(parsed);
      }
      if (message.ReceiptHandle) {
        await client.send(
          new DeleteMessageCommand({
            QueueUrl: sqsConfig.eventsQueueUrl,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
      }
    }
  }
  return collected;
}

describe('OutboxPublisherWorker (integration)', () => {
  let appA: INestApplicationContext;
  let appB: INestApplicationContext;
  let sqsClient: SQSClient;

  beforeAll(async () => {
    appA = await createFullTestApp();
    appB = await createFullTestApp();
    sqsClient = appA.get(SQS_CLIENT);
    await sqsClient
      .send(new PurgeQueueCommand({ QueueUrl: sqsConfig.eventsQueueUrl }))
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    await appA.close();
    await appB.close();
  });

  it('publishes WalletBalanceChanged and WagerTransactionProcessed after a BET commits, exactly once each', async () => {
    const createWallet = appA.get(CreateWalletUseCase);
    const submit = appA.get(SubmitWagerTransactionUseCase);

    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = `outbox-${randomUUID()}`;

    await submit.execute({
      providerId,
      externalTransactionId: 'ext-1',
      idempotencyKey: `${providerId}:ext-1`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: '25.00', currency: 'BRL' }),
    });

    const messages: Array<{ eventId: string; eventType: string }> = [];
    await waitFor(
      async () => {
        messages.push(...(await drainQueue(sqsClient, 3)));
        const types = messages.map((m) => m.eventType);
        return (
          types.includes('WagerTransactionProcessed') && types.includes('WalletBalanceChanged')
        );
      },
      { timeoutMs: 8_000 },
    );

    const processedEvents = messages.filter(
      (m) => m.eventType === 'WagerTransactionProcessed' && m.eventId,
    );
    const uniqueEventIds = new Set(messages.map((m) => m.eventId));
    expect(uniqueEventIds.size).toBe(messages.length);
    expect(processedEvents.length).toBeGreaterThanOrEqual(1);
  }, 15_000);

  it('two publisher instances racing on the same outbox table never double-publish', async () => {
    const createWallet = appA.get(CreateWalletUseCase);
    const submit = appA.get(SubmitWagerTransactionUseCase);
    const providerId = `outbox-race-${randomUUID()}`;

    const wallets = await Promise.all(
      Array.from({ length: 8 }, () =>
        createWallet.execute({
          playerId: randomUUID(),
          initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
        }),
      ),
    );

    await Promise.all(
      wallets.map((wallet, index) =>
        submit.execute({
          providerId,
          externalTransactionId: `ext-${index}`,
          idempotencyKey: `${providerId}:ext-${index}`,
          playerId: wallet.playerId,
          walletId: wallet.id,
          roundId: 'round-1',
          gameId: 'fortune-chimp',
          kind: WagerTransactionKind.Bet,
          money: Money.from({ amount: '10.00', currency: 'BRL' }),
        }),
      ),
    );

    const collected: Array<{ eventId: string; eventType: string }> = [];
    await waitFor(
      async () => {
        collected.push(...(await drainQueue(sqsClient, 3)));
        return collected.filter((m) => m.eventType === 'WagerTransactionProcessed').length >= 8;
      },
      { timeoutMs: 10_000 },
    );

    await new Promise((resolve) => setTimeout(resolve, 500));
    collected.push(...(await drainQueue(sqsClient, 3)));

    const processedEventIds = collected
      .filter((m) => m.eventType === 'WagerTransactionProcessed')
      .map((m) => m.eventId);
    expect(new Set(processedEventIds).size).toBe(processedEventIds.length);
  }, 20_000);
});
