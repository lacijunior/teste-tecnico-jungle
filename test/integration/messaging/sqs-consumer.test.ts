import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { Money } from '../../../src/domain/money/money.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../../../src/domain/wagering/wager-transaction-status.js';
import { CreateWalletUseCase } from '../../../src/application/wallet/create-wallet.use-case.js';
import {
  PermanentMessageError,
  SqsConsumerAdapter,
} from '../../../src/infrastructure/messaging/sqs/sqs-consumer.adapter.js';
import { SQS_CLIENT } from '../../../src/infrastructure/messaging/sqs/sqs.tokens.js';
import { sqsConfig } from '../../../src/infrastructure/config/wagering.config.js';
import { WalletEntity } from '../../../src/infrastructure/persistence/mikro-orm/entities/wallet.entity.js';
import { WagerTransactionEntity } from '../../../src/infrastructure/persistence/mikro-orm/entities/wager-transaction.entity.js';
import { InboxMessageEntity } from '../../../src/infrastructure/persistence/mikro-orm/entities/inbox-message.entity.js';
import { createFullTestApp } from '../../support/test-app.js';
import { waitFor } from '../../support/wait-for.js';

interface ConsumerInternals {
  processWithinTransaction(messageId: string, body: string): Promise<void>;
}

describe('SqsConsumerAdapter (integration)', () => {
  let app: INestApplicationContext;
  let createWallet: CreateWalletUseCase;
  let orm: MikroORM;
  let sqsClient: SQSClient;
  let consumer: SqsConsumerAdapter;

  beforeAll(async () => {
    app = await createFullTestApp();
    createWallet = app.get(CreateWalletUseCase);
    orm = app.get(MikroORM);
    sqsClient = app.get(SQS_CLIENT);
    consumer = app.get(SqsConsumerAdapter);
  });

  afterAll(async () => {
    await app.close();
  });

  it('processes a real message received from the wager-transactions.fifo queue and acks it', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = `sqs-${randomUUID()}`;
    const idempotencyKey = `${providerId}:ext-1`;

    const body = JSON.stringify({
      messageId: `msg-${randomUUID()}`,
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId,
        externalTransactionId: 'ext-1',
        idempotencyKey,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: { amount: '25.00', currency: 'BRL' },
      },
    });

    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: sqsConfig.queueUrl,
        MessageBody: body,
        MessageGroupId: wallet.id,
        MessageDeduplicationId: randomUUID(),
      }),
    );

    await waitFor(
      async () => {
        const em = orm.em.fork();
        const entity = await em.getRepository(WagerTransactionEntity).findOne({ idempotencyKey });
        return entity?.status === WagerTransactionStatus.Processed;
      },
      { timeoutMs: 40_000 },
    );

    const em = orm.em.fork();
    const walletEntity = await em.getRepository(WalletEntity).findOne({ id: wallet.id });
    expect(walletEntity?.balanceAmount).toBe('75.00');
  }, 45_000);

  it('does not reapply the operation when the same SQS message is redelivered', async () => {
    const wallet = await createWallet.execute({
      playerId: randomUUID(),
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    });
    const providerId = `sqs-redelivery-${randomUUID()}`;
    const messageId = `msg-${randomUUID()}`;
    const body = JSON.stringify({
      messageId,
      type: 'WagerTransactionRequested',
      occurredAt: new Date().toISOString(),
      data: {
        providerId,
        externalTransactionId: 'ext-1',
        idempotencyKey: `${providerId}:ext-1`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: { amount: '25.00', currency: 'BRL' },
      },
    });

    const internals = consumer as unknown as ConsumerInternals;
    await internals.processWithinTransaction(messageId, body);
    await internals.processWithinTransaction(messageId, body);

    const em = orm.em.fork();
    const walletEntity = await em.getRepository(WalletEntity).findOne({ id: wallet.id });
    expect(walletEntity?.balanceAmount).toBe('75.00');

    const inboxEntity = await em
      .getRepository(InboxMessageEntity)
      .findOne({ consumerName: 'wagering-transactions-consumer', messageId });
    expect(inboxEntity?.processedAt).not.toBeUndefined();
  });

  it('classifies a malformed message as a permanent failure instead of a generic error', async () => {
    const internals = consumer as unknown as ConsumerInternals;

    await expect(
      internals.processWithinTransaction(`msg-${randomUUID()}`, 'not valid json at all'),
    ).rejects.toThrow(PermanentMessageError);

    await expect(
      internals.processWithinTransaction(
        `msg-${randomUUID()}`,
        JSON.stringify({ messageId: 'x', type: 'WagerTransactionRequested' }),
      ),
    ).rejects.toThrow(PermanentMessageError);
  });
});
