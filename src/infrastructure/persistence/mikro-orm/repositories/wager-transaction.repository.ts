import { EntityRepository } from '@mikro-orm/postgresql';
import type { WagerTransactionEntity } from '../entities/wager-transaction.entity.js';
import type { WagerTransactionKind } from '../../../../domain/wagering/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../../../../domain/wagering/wager-transaction-status.js';

export class WagerTransactionRepository extends EntityRepository<WagerTransactionEntity> {
  public async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WagerTransactionEntity | null> {
    return this.findOne({ idempotencyKey });
  }

  public async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionEntity | null> {
    return this.findOne({ providerId, externalTransactionId });
  }

  public async findProcessedReversalByReference(
    kind: WagerTransactionKind,
    referenceTransactionId: string,
  ): Promise<WagerTransactionEntity | null> {
    return this.findOne({
      kind,
      referenceTransactionId,
      status: WagerTransactionStatus.Processed,
    });
  }

  public async findDuePendingReferences(
    now: Date,
    limit: number,
  ): Promise<WagerTransactionEntity[]> {
    return this.find(
      {
        status: WagerTransactionStatus.PendingReference,
        $or: [{ nextReferenceAttemptAt: null }, { nextReferenceAttemptAt: { $lte: now } }],
      },
      { limit, orderBy: { createdAt: 'asc' } },
    );
  }
}
