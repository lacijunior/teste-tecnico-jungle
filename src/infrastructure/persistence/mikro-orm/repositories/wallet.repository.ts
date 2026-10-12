import { EntityRepository } from '@mikro-orm/postgresql';
import type { WalletEntity } from '../entities/wallet.entity.js';

export class WalletRepository extends EntityRepository<WalletEntity> {
  public async findByPlayerAndCurrency(
    playerId: string,
    currency: string,
  ): Promise<WalletEntity | null> {
    return this.findOne({ playerId, currency });
  }
}
