import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { MikroORM } from '@mikro-orm/core';
import { Money } from '../../../src/domain/money/money.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';
import { CreateWalletUseCase } from '../../../src/application/wallet/create-wallet.use-case.js';
import { SubmitWagerTransactionUseCase } from '../../../src/application/wagering/submit-wager-transaction.use-case.js';
import {
  MESSAGE_PUBLISHER,
  type MessagePublisher,
} from '../../../src/application/ports/message-publisher.js';
import { OutboxMessageEntity } from '../../../src/infrastructure/persistence/mikro-orm/entities/outbox-message.entity.js';
import { createFullTestApp } from '../../support/test-app.js';
import { waitFor } from '../../support/wait-for.js';

describe('OutboxPublisherWorker tolerates a lease expiring mid-publish (integration)', () => {
  it('still ends up durably published, without crashing, when a second instance reclaims the message while the first is still mid-publish', async () => {
    // OUTBOX_CLAIM_LEASE_MS is forced to 1000ms for tests (see setup-env.ts) — well under this.
    const slowPublisher: MessagePublisher = {
      async publish(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, 2500));
      },
    };
    const fastPublisher: MessagePublisher = {
      async publish(): Promise<void> {
        // Resolves immediately, simulating the instance that reclaims after the lease expires.
      },
    };

    const appSlow = await createFullTestApp((builder) =>
      builder.overrideProvider(MESSAGE_PUBLISHER).useValue(slowPublisher),
    );
    const appFast = await createFullTestApp((builder) =>
      builder.overrideProvider(MESSAGE_PUBLISHER).useValue(fastPublisher),
    );

    try {
      const createWallet = appSlow.get(CreateWalletUseCase);
      const submit = appSlow.get(SubmitWagerTransactionUseCase);
      const orm = appSlow.get(MikroORM);

      const wallet = await createWallet.execute({
        playerId: randomUUID(),
        initialBalance: Money.from({ amount: '0.00', currency: 'BRL' }),
      });
      const providerId = `lease-race-${randomUUID()}`;

      await submit.execute({
        providerId,
        externalTransactionId: 'ext-1',
        idempotencyKey: `${providerId}:ext-1`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Win,
        money: Money.from({ amount: '10.00', currency: 'BRL' }),
      });

      await waitFor(
        async () => {
          const em = orm.em.fork();
          const pending = await em
            .getRepository(OutboxMessageEntity)
            .count({ aggregateId: wallet.id, publishedAt: null });
          return pending === 0;
        },
        { timeoutMs: 8_000 },
      );

      const em = orm.em.fork();
      const messages = await em.getRepository(OutboxMessageEntity).find({ aggregateId: wallet.id });
      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) {
        expect(message.publishedAt).not.toBeUndefined();
      }
    } finally {
      // appSlow.close() waits for its in-flight (slow) tick to finish, exercising the second,
      // late finalize against a row the other instance may have already marked published.
      await Promise.all([appSlow.close(), appFast.close()]);
    }
  }, 20_000);
});
