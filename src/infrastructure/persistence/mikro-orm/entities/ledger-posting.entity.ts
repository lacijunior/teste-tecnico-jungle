import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { LedgerAccountType } from '../../../../domain/ledger/ledger-account.js';
import { LedgerPostingRepository } from '../repositories/ledger-posting.repository.js';

@Entity({ tableName: 'ledger_postings', repository: () => LedgerPostingRepository })
@Unique({ properties: ['transactionId'] })
export class LedgerPostingEntity {
  @PrimaryKey({ type: 'uuid' })
  public id!: string;

  @Property({ fieldName: 'transaction_id', type: 'uuid' })
  public transactionId!: string;

  @Property({ fieldName: 'debit_account_type' })
  public debitAccountType!: LedgerAccountType;

  @Property({ fieldName: 'debit_account_reference_id' })
  public debitAccountReferenceId!: string;

  @Property({ fieldName: 'credit_account_type' })
  public creditAccountType!: LedgerAccountType;

  @Property({ fieldName: 'credit_account_reference_id' })
  public creditAccountReferenceId!: string;

  @Property({ fieldName: 'money_amount', type: 'numeric', precision: 19, scale: 2 })
  public moneyAmount!: string;

  @Property({ fieldName: 'money_currency', length: 3 })
  public moneyCurrency!: string;

  @Property({ fieldName: 'created_at' })
  public createdAt: Date = new Date();
}
