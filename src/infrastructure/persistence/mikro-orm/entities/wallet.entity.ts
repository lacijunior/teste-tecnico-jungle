import { Check, Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { WalletRepository } from '../repositories/wallet.repository.js';

@Entity({ tableName: 'wallets', repository: () => WalletRepository })
@Unique({ properties: ['playerId', 'currency'] })
@Check({ name: 'wallets_balance_amount_non_negative', expression: 'balance_amount >= 0' })
export class WalletEntity {
  @PrimaryKey({ type: 'uuid' })
  public id!: string;

  @Property({ fieldName: 'player_id', type: 'uuid' })
  @Index()
  public playerId!: string;

  @Property({ length: 3 })
  public currency!: string;

  @Property({ fieldName: 'balance_amount', type: 'numeric', precision: 19, scale: 2 })
  public balanceAmount!: string;

  @Property({ version: true, type: 'integer' })
  public version: number = 1;

  @Property({ fieldName: 'created_at' })
  public createdAt: Date = new Date();

  @Property({ fieldName: 'updated_at' })
  public updatedAt: Date = new Date();
}
