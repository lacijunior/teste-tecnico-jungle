import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import type { SQSClient } from '@aws-sdk/client-sqs';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { SQS_CLIENT } from '../../../src/infrastructure/messaging/sqs/sqs.tokens.js';
import { sqsConfig } from '../../../src/infrastructure/config/wagering.config.js';
import { createTestApp } from '../../support/test-app.js';
import { waitFor } from '../../support/wait-for.js';

describe('SQS dead-letter redrive (integration)', () => {
  let app: INestApplicationContext;
  let sqsClient: SQSClient;

  beforeAll(async () => {
    app = await createTestApp();
    sqsClient = app.get(SQS_CLIENT);
  });

  afterAll(async () => {
    await app.close();
  });

  it('moves a message to the DLQ once SQS_CONSUMER_MAX_RECEIVE_COUNT is exhausted without an ack', async () => {
    // Replicates, on a disposable queue pair, the exact RedrivePolicy configured in production
    // (scripts/localstack-init/create-queues.sh) for wager-transactions.fifo. A dedicated pair
    // avoids any interference from the real SqsConsumerAdapter instances other integration test
    // files keep polling on the shared business queue, while still proving the redrive mechanism
    // SQS_CONSUMER_MAX_RECEIVE_COUNT depends on.
    const suffix = randomUUID();
    const dlqName = `dlq-redrive-test-dlq-${suffix}.fifo`;
    const queueName = `dlq-redrive-test-${suffix}.fifo`;

    const dlq = await sqsClient.send(
      new CreateQueueCommand({
        QueueName: dlqName,
        Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'false' },
      }),
    );
    const dlqUrl = dlq.QueueUrl!;
    const dlqArnResponse = await sqsClient.send(
      new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ['QueueArn'] }),
    );
    const dlqArn = dlqArnResponse.Attributes!.QueueArn!;

    const queue = await sqsClient.send(
      new CreateQueueCommand({
        QueueName: queueName,
        Attributes: {
          FifoQueue: 'true',
          ContentBasedDeduplication: 'false',
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: dlqArn,
            maxReceiveCount: String(sqsConfig.maxReceiveCount),
          }),
        },
      }),
    );
    const queueUrl = queue.QueueUrl!;

    try {
      const marker = `dlq-redrive-marker-${randomUUID()}`;
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: marker,
          MessageGroupId: randomUUID(),
          MessageDeduplicationId: randomUUID(),
        }),
      );

      for (
        let receiveAttempt = 0;
        receiveAttempt < sqsConfig.maxReceiveCount;
        receiveAttempt += 1
      ) {
        const response = await sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: 1,
            VisibilityTimeout: 0,
            WaitTimeSeconds: 2,
          }),
        );
        expect(response.Messages?.[0]?.Body).toBe(marker);
      }

      await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 1,
          VisibilityTimeout: 0,
          WaitTimeSeconds: 2,
        }),
      );

      await waitFor(
        async () => {
          const dlqResponse = await sqsClient.send(
            new ReceiveMessageCommand({
              QueueUrl: dlqUrl,
              MaxNumberOfMessages: 1,
              WaitTimeSeconds: 2,
            }),
          );
          return dlqResponse.Messages?.[0]?.Body === marker;
        },
        { timeoutMs: 15_000, intervalMs: 500 },
      );
    } finally {
      await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl })).catch(() => undefined);
      await sqsClient.send(new DeleteQueueCommand({ QueueUrl: dlqUrl })).catch(() => undefined);
    }
  }, 30_000);
});
