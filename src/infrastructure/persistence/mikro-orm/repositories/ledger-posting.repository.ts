import { Decimal } from 'decimal.js';
import { EntityRepository } from '@mikro-orm/postgresql';
import type { LedgerPostingEntity } from '../entities/ledger-posting.entity.js';
import type { LedgerAccountType } from '../../../../domain/ledger/ledger-account.js';

export class LedgerPostingRepository extends EntityRepository<LedgerPostingEntity> {
  public async findByTransaction(transactionId: string): Promise<LedgerPostingEntity | null> {
    return this.findOne({ transactionId });
  }

  public async sumByAccount(
    type: LedgerAccountType,
    referenceId: string,
  ): Promise<{ debits: string; credits: string }> {
    const connection = this.getEntityManager().getConnection();
    const [debitRow] = await connection.execute<Array<{ total: string | null }>>(
      `select coalesce(sum(money_amount), 0) as total from ledger_postings
       where debit_account_type = ? and debit_account_reference_id = ?`,
      [type, referenceId],
    );
    const [creditRow] = await connection.execute<Array<{ total: string | null }>>(
      `select coalesce(sum(money_amount), 0) as total from ledger_postings
       where credit_account_type = ? and credit_account_reference_id = ?`,
      [type, referenceId],
    );
    return {
      debits: new Decimal(debitRow?.total ?? '0').toFixed(2),
      credits: new Decimal(creditRow?.total ?? '0').toFixed(2),
    };
  }
}
