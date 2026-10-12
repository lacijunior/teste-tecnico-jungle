import { WagerTransaction } from '../../../../domain/wagering/wager-transaction.js';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity.js';

export class WagerTransactionMapper {
  public static toDomain(entity: WagerTransactionEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind,
      money: { amount: entity.moneyAmount, currency: entity.moneyCurrency },
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      createdAt: entity.createdAt,
      status: entity.status,
      referenceTransactionId: entity.referenceTransactionId,
      failureCode: entity.failureCode,
      processedAt: entity.processedAt,
      pendingReferenceAttempts: entity.pendingReferenceAttempts,
      nextReferenceAttemptAt: entity.nextReferenceAttemptAt,
      balanceSnapshot: entity.balanceSnapshotAmount
        ? { amount: entity.balanceSnapshotAmount, currency: entity.moneyCurrency }
        : undefined,
    });
  }

  public static toNewEntity(transaction: WagerTransaction): WagerTransactionEntity {
    const entity = new WagerTransactionEntity();
    entity.id = transaction.id;
    entity.providerId = transaction.providerId;
    entity.externalTransactionId = transaction.externalTransactionId;
    entity.idempotencyKey = transaction.idempotencyKey;
    entity.payloadHash = transaction.payloadHash;
    entity.walletId = transaction.walletId;
    entity.playerId = transaction.playerId;
    entity.roundId = transaction.roundId;
    entity.gameId = transaction.gameId;
    entity.kind = transaction.kind;
    entity.moneyAmount = transaction.money.toJSON().amount;
    entity.moneyCurrency = transaction.money.toJSON().currency;
    entity.referenceExternalTransactionId = transaction.referenceExternalTransactionId;
    entity.createdAt = transaction.createdAt;
    this.applyMutableFields(transaction, entity);
    return entity;
  }

  public static applyMutableFields(
    transaction: WagerTransaction,
    entity: WagerTransactionEntity,
  ): void {
    entity.status = transaction.status;
    entity.referenceTransactionId = transaction.referenceTransactionId;
    entity.failureCode = transaction.failureCode;
    entity.processedAt = transaction.processedAt;
    entity.pendingReferenceAttempts = transaction.pendingReferenceAttempts;
    entity.nextReferenceAttemptAt = transaction.nextReferenceAttemptAt;
    entity.balanceSnapshotAmount = transaction.balanceSnapshot?.toJSON().amount;
  }
}
