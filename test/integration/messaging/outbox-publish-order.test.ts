import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Money } from '../../../src/domain/money/money.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';
import { CreateWalletUseCase } from '../../../src/application/wallet/create-wallet.use-case.js';
import { SubmitWagerTransactionUseCase } from '../../../src/application/wagering/submit-wager-transaction.use-case.js';
import {
  MESSAGE_PUBLISHER,
  type MessagePublisher,
  type PublishMessageParams,
} from '../../../src/application/ports/message-publisher.js';
import { createFullTestApp } from '../../support/test-app.js';
import { waitFor } from '../../support/wait-for.js';

describe('OutboxPublisherWorker preserves per-aggregate publish order (integration)', () => {
  it('never starts publishing a later same-wallet event before an earlier one finishes, even when the earlier publish is slow', async () => {
    let walletId: string | undefined;
    const invocationsByPartition = new Map<string, number>();
    const recorded: Array<{ partitionKey: string; body: string; startedAt: number }> = [];

    const recordingPublisher: MessagePublisher = {
      async publish(params: PublishMessageParams): Promise<void> {
        const count = (invocationsByPartition.get(params.partitionKey) ?? 0) + 1;
        invocationsByPartition.set(params.partitionKey, count);
        recorded.push({
          partitionKey: params.partitionKey,
          body: params.body,
          startedAt: Date.now(),
        });
        if (params.partitionKey === walletId && count === 1) {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      },
    };

    const app = await createFullTestApp((builder) =>
      builder.overrideProvider(MESSAGE_PUBLISHER).useValue(recordingPublisher),
    );

    try {
      const createWallet = app.get(CreateWalletUseCase);
      const submit = app.get(SubmitWagerTransactionUseCase);

      const wallet = await createWallet.execute({
        playerId: randomUUID(),
        // Zero initial balance so no OPENING credit (and its own WalletBalanceChanged event
        // for this same aggregateId) is created — it would otherwise be a third event here.
        initialBalance: Money.from({ amount: '0.00', currency: 'BRL' }),
      });
      walletId = wallet.id;
      const providerId = `order-${randomUUID()}`;

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
      await submit.execute({
        providerId,
        externalTransactionId: 'ext-2',
        idempotencyKey: `${providerId}:ext-2`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Win,
        money: Money.from({ amount: '20.00', currency: 'BRL' }),
      });

      await waitFor(
        async () => recorded.filter((entry) => entry.partitionKey === walletId).length >= 2,
        { timeoutMs: 10_000 },
      );

      const walletEvents = recorded
        .filter((entry) => entry.partitionKey === walletId)
        .sort((a, b) => a.startedAt - b.startedAt);
      expect(walletEvents).toHaveLength(2);

      const balancesAfter = walletEvents.map(
        (entry) =>
          (JSON.parse(entry.body) as { data: { balanceAfter: { amount: string } } }).data
            .balanceAfter.amount,
      );
      expect(balancesAfter).toEqual(['10.00', '30.00']);

      // The second same-wallet publish must not even start until the first (artificially
      // slowed to 400ms) one finishes — proof that they were not fired concurrently.
      expect(walletEvents[1]!.startedAt - walletEvents[0]!.startedAt).toBeGreaterThanOrEqual(350);
    } finally {
      await app.close();
    }
  }, 15_000);
});
