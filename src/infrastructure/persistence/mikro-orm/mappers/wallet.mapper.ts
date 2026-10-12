import { Wallet } from '../../../../domain/wallet/wallet.js';
import { WalletEntity } from '../entities/wallet.entity.js';

export class WalletMapper {
  public static toDomain(entity: WalletEntity): Wallet {
    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: { amount: entity.balanceAmount, currency: entity.currency },
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  public static toNewEntity(wallet: Wallet): WalletEntity {
    const entity = new WalletEntity();
    entity.id = wallet.id;
    entity.playerId = wallet.playerId;
    entity.currency = wallet.currency;
    entity.balanceAmount = wallet.balance.toJSON().amount;
    entity.createdAt = wallet.createdAt;
    entity.updatedAt = wallet.updatedAt;
    return entity;
  }

  public static applyMutation(wallet: Wallet, entity: WalletEntity): void {
    entity.balanceAmount = wallet.balance.toJSON().amount;
    entity.updatedAt = wallet.updatedAt;
  }
}
