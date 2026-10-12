import { Decimal } from 'decimal.js';
import { EntityRepository } from '@mikro-orm/postgresql';
import type { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';
import { LedgerDirection } from '../../../../domain/wallet/ledger-direction.js';
import { InvalidLedgerCursorError } from '../../../../application/wallet/wallet-application.errors.js';

export interface LedgerPage {
  entries: WalletLedgerEntryEntity[];
  nextCursor: string | undefined;
}

export class WalletLedgerEntryRepository extends EntityRepository<WalletLedgerEntryEntity> {
  public async findByWalletAndTransaction(
    walletId: string,
    transactionId: string,
  ): Promise<WalletLedgerEntryEntity | null> {
    return this.findOne({ walletId, transactionId });
  }

  public async listByWallet(
    walletId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<LedgerPage> {
    const decodedCursor = cursor ? decodeCursor(cursor) : undefined;
    // Matches the ORDER BY (createdAt desc, id desc) exactly: strictly before the cursor's
    // createdAt, or tied on createdAt and strictly before the cursor's id. A plain
    // `createdAt <= cursor` would repeat rows that share the cursor's timestamp — plausible
    // under concurrent writes — since it doesn't use `id` to break the tie the same way the
    // ordering does.
    const entries = await this.find(
      {
        walletId,
        ...(decodedCursor
          ? {
              $or: [
                { createdAt: { $lt: decodedCursor.createdAt } },
                { createdAt: decodedCursor.createdAt, id: { $lt: decodedCursor.id } },
              ],
            }
          : {}),
      },
      { orderBy: { createdAt: 'desc', id: 'desc' }, limit: limit + 1 },
    );
    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    const last = page.at(-1);
    return {
      entries: page,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : undefined,
    };
  }

  public async calculateBalance(walletId: string): Promise<{ amount: string; entries: number }> {
    const connection = this.getEntityManager().getConnection();
    const result = await connection.execute<Array<{ amount: string | null; count: string }>>(
      `select
         coalesce(sum(case when direction = ? then money_amount else -money_amount end), 0) as amount,
         count(*) as count
       from wallet_ledger_entries
       where wallet_id = ?`,
      [LedgerDirection.Credit, walletId],
    );
    const row = result[0];
    return {
      amount: new Decimal(row?.amount ?? '0').toFixed(2),
      entries: Number(row?.count ?? 0),
    };
  }
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const parsedCreatedAt = createdAt ? new Date(createdAt) : undefined;
  if (!parsedCreatedAt || Number.isNaN(parsedCreatedAt.getTime()) || !id) {
    throw new InvalidLedgerCursorError(cursor);
  }
  return { createdAt: parsedCreatedAt, id };
}
