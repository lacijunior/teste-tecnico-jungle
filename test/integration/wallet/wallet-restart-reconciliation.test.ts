import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Money } from '../../../src/domain/money/money.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction-kind.js';
import { CreateWalletUseCase } from '../../../src/application/wallet/create-wallet.use-case.js';
import { WalletQueryService } from '../../../src/application/wallet/wallet-query.service.js';
import { SubmitWagerTransactionUseCase } from '../../../src/application/wagering/submit-wager-transaction.use-case.js';
import { createTestApp } from '../../support/test-app.js';

describe('wallet.balance stays reconciled with the ledger across a real service restart (AC4)', () => {
  it('reports a consistent balance from a brand-new instance after the committing instance shut down', async () => {
    const firstInstance = await createTestApp();
    let walletId: string;
    try {
      const createWallet = firstInstance.get(CreateWalletUseCase);
      const submit = firstInstance.get(SubmitWagerTransactionUseCase);
      const providerId = `restart-${randomUUID()}`;

      const wallet = await createWallet.execute({
        playerId: randomUUID(),
        initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      });
      walletId = wallet.id;

      await submit.execute({
        providerId,
        externalTransactionId: 'ext-1',
        idempotencyKey: `${providerId}:ext-1`,
        playerId: wallet.playerId,
        walletId: wallet.id,
        roundId: 'round-1',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: '30.00', currency: 'BRL' }),
      });
    } finally {
      await firstInstance.close();
    }

    const restartedInstance = await createTestApp();
    try {
      const walletQuery = restartedInstance.get(WalletQueryService);
      const reconciliation = await walletQuery.reconcile(walletId);

      expect(reconciliation.consistent).toBe(true);
      expect(reconciliation.storedBalance).toEqual({ amount: '70.00', currency: 'BRL' });
      expect(reconciliation.calculatedBalance).toEqual({ amount: '70.00', currency: 'BRL' });
    } finally {
      await restartedInstance.close();
    }
  });
});
