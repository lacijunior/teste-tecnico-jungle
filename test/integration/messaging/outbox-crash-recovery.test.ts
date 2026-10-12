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
import { createTestApp, createFullTestApp } from '../../support/test-app.js';
import { waitFor } from '../../support/wait-for.js';

async function drainQueue(
  client: SQSClient,
  maxBatches = 10,
): Promise<Array<{ eventId: string; eventType: string; correlationId: string }>> {
  const collected: Array<{ eventId: string; eventType: string; correlationId: string }> = [];
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
        collected.push(
          JSON.parse(message.Body) as { eventId: string; eventType: string; correlationId: string },
        );
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

describe('Outbox publication survives the process that committed it dying (integration)', () => {
  let appWithoutWorkers: INestApplicationContext;
  let sqsClient: SQSClient;

  beforeAll(async () => {
    appWithoutWorkers = await createTestApp();
    sqsClient = appWithoutWorkers.get(SQS_CLIENT);
    await sqsClient
      .send(new PurgeQueueCommand({ QueueUrl: sqsConfig.eventsQueueUrl }))
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    await appWithoutWorkers.close();
  });

  it('is published by a different instance once it starts, after the committing instance never publishes it', async () => {
    const createWallet = appWithoutWorkers.get(CreateWalletUseCase);
    const submit = appWithoutWorkers.get(SubmitWagerTransactionUseCase);
    const providerId = `outbox-crash-${randomUUID()}`;

    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });

    const result = await submit.execute({
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

    const noEarlyPublish = await drainQueue(sqsClient, 2);
    expect(noEarlyPublish).toHaveLength(0);

    const recoveredApp = await createFullTestApp();
    try {
      const messages: Array<{ eventId: string; eventType: string; correlationId: string }> = [];
      await waitFor(
        async () => {
          messages.push(...(await drainQueue(sqsClient, 3)));
          return messages.some(
            (m) =>
              m.eventType === 'WagerTransactionProcessed' &&
              m.correlationId === result.transactionId,
          );
        },
        { timeoutMs: 10_000 },
      );
    } finally {
      await recoveredApp.close();
    }
  }, 20_000);
});
