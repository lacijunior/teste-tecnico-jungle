import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { LedgerDirection } from '../../../../domain/wallet/ledger-direction.js';
import { WalletLedgerEntryRepository } from '../repositories/wallet-ledger-entry.repository.js';

@Entity({ tableName: 'wallet_ledger_entries', repository: () => WalletLedgerEntryRepository })
@Unique({ properties: ['walletId', 'transactionId'] })
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: 'uuid' })
  public id!: string;

  @Property({ fieldName: 'wallet_id', type: 'uuid' })
  @Index()
  public walletId!: string;

  @Property({ fieldName: 'transaction_id', type: 'uuid' })
  public transactionId!: string;

  @Property()
  public direction!: LedgerDirection;

  @Property({ fieldName: 'money_amount', type: 'numeric', precision: 19, scale: 2 })
  public moneyAmount!: string;

  @Property({ fieldName: 'money_currency', length: 3 })
  public moneyCurrency!: string;

  @Property({ fieldName: 'balance_before', type: 'numeric', precision: 19, scale: 2 })
  public balanceBefore!: string;

  @Property({ fieldName: 'balance_after', type: 'numeric', precision: 19, scale: 2 })
  public balanceAfter!: string;

  @Property({ fieldName: 'created_at' })
  public createdAt: Date = new Date();
}
