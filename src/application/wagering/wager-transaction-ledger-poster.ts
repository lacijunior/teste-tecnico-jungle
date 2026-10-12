import { DoubleEntryPosting } from '../../domain/ledger/double-entry-posting.js';
import { LedgerDirection } from '../../domain/wallet/ledger-direction.js';
import type { Wallet } from '../../domain/wallet/wallet.js';
import { WalletLedgerEntry } from '../../domain/wallet/wallet-ledger-entry.js';
import type { WagerTransaction } from '../../domain/wagering/wager-transaction.js';
import type { IdGenerator } from '../ports/id-generator.js';

export interface PostWagerTransactionLedgerMovementParams {
  idGenerator: IdGenerator;
  transaction: WagerTransaction;
  wallet: Wallet;
  direction: LedgerDirection;
  now: Date;
  referenceTransactionId?: string;
}

export interface WagerTransactionLedgerMovement {
  ledgerEntry: WalletLedgerEntry;
  posting: DoubleEntryPosting;
}

export class WagerTransactionLedgerPoster {
  public static post(
    params: PostWagerTransactionLedgerMovementParams,
  ): WagerTransactionLedgerMovement {
    const { idGenerator, transaction, wallet, direction, now, referenceTransactionId } = params;

    const mutation =
      direction === LedgerDirection.Debit
        ? wallet.debit(transaction.money, now)
        : wallet.credit(transaction.money, now);

    const ledgerEntry = WalletLedgerEntry.create({
      id: idGenerator.next(),
      walletId: wallet.id,
      transactionId: transaction.id,
      direction,
      money: transaction.money,
      balanceBefore: mutation.balanceBefore,
      balanceAfter: mutation.balanceAfter,
      createdAt: now,
    });

    transaction.markProcessed(referenceTransactionId, now, wallet.balance);

    const posting = DoubleEntryPosting.forWalletMovement({
      id: idGenerator.next(),
      transactionId: transaction.id,
      walletId: wallet.id,
      providerId: transaction.providerId,
      direction,
      money: transaction.money,
      createdAt: now,
    });

    return { ledgerEntry, posting };
  }
}
