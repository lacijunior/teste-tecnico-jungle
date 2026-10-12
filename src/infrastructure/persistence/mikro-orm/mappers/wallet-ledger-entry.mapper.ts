import { WalletLedgerEntry } from '../../../../domain/wallet/wallet-ledger-entry.js';
import { WalletLedgerEntryEntity } from '../entities/wallet-ledger-entry.entity.js';

export class WalletLedgerEntryMapper {
  public static toDomain(entity: WalletLedgerEntryEntity): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: entity.id,
      walletId: entity.walletId,
      transactionId: entity.transactionId,
      direction: entity.direction,
      money: { amount: entity.moneyAmount, currency: entity.moneyCurrency },
      balanceBefore: { amount: entity.balanceBefore, currency: entity.moneyCurrency },
      balanceAfter: { amount: entity.balanceAfter, currency: entity.moneyCurrency },
      createdAt: entity.createdAt,
    });
  }

  public static toNewEntity(entry: WalletLedgerEntry): WalletLedgerEntryEntity {
    const entity = new WalletLedgerEntryEntity();
    entity.id = entry.id;
    entity.walletId = entry.walletId;
    entity.transactionId = entry.transactionId;
    entity.direction = entry.direction;
    entity.moneyAmount = entry.money.toJSON().amount;
    entity.moneyCurrency = entry.money.toJSON().currency;
    entity.balanceBefore = entry.balanceBefore.toJSON().amount;
    entity.balanceAfter = entry.balanceAfter.toJSON().amount;
    entity.createdAt = entry.createdAt;
    return entity;
  }
}
