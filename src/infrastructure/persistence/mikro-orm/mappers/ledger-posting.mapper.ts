import { DoubleEntryPosting } from '../../../../domain/ledger/double-entry-posting.js';
import { LedgerPostingEntity } from '../entities/ledger-posting.entity.js';

export class LedgerPostingMapper {
  public static toDomain(entity: LedgerPostingEntity): DoubleEntryPosting {
    return DoubleEntryPosting.rehydrate({
      id: entity.id,
      transactionId: entity.transactionId,
      debitAccount: { type: entity.debitAccountType, referenceId: entity.debitAccountReferenceId },
      creditAccount: {
        type: entity.creditAccountType,
        referenceId: entity.creditAccountReferenceId,
      },
      money: { amount: entity.moneyAmount, currency: entity.moneyCurrency },
      createdAt: entity.createdAt,
    });
  }

  public static toNewEntity(posting: DoubleEntryPosting): LedgerPostingEntity {
    const entity = new LedgerPostingEntity();
    entity.id = posting.id;
    entity.transactionId = posting.transactionId;
    entity.debitAccountType = posting.debitAccount.type;
    entity.debitAccountReferenceId = posting.debitAccount.referenceId;
    entity.creditAccountType = posting.creditAccount.type;
    entity.creditAccountReferenceId = posting.creditAccount.referenceId;
    entity.moneyAmount = posting.money.toJSON().amount;
    entity.moneyCurrency = posting.money.toJSON().currency;
    entity.createdAt = posting.createdAt;
    return entity;
  }
}
