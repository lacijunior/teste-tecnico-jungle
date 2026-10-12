import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { FailureCode } from '../../../../domain/wagering/failure-code.js';
import type { WagerTransactionKind } from '../../../../domain/wagering/wager-transaction-kind.js';
import type { WagerTransactionStatus } from '../../../../domain/wagering/wager-transaction-status.js';
import { WagerTransactionRepository } from '../repositories/wager-transaction.repository.js';

@Entity({ tableName: 'wager_transactions', repository: () => WagerTransactionRepository })
@Unique({ properties: ['idempotencyKey'] })
@Unique({ properties: ['providerId', 'externalTransactionId'] })
@Index({ properties: ['status', 'nextReferenceAttemptAt'] })
export class WagerTransactionEntity {
  @PrimaryKey({ type: 'uuid' })
  public id!: string;

  @Property({ fieldName: 'provider_id' })
  public providerId!: string;

  @Property({ fieldName: 'external_transaction_id' })
  public externalTransactionId!: string;

  @Property({ fieldName: 'idempotency_key' })
  public idempotencyKey!: string;

  @Property({ fieldName: 'payload_hash' })
  public payloadHash!: string;

  @Property({ fieldName: 'wallet_id', type: 'uuid' })
  @Index()
  public walletId!: string;

  @Property({ fieldName: 'player_id', type: 'uuid' })
  public playerId!: string;

  @Property({ fieldName: 'round_id' })
  public roundId!: string;

  @Property({ fieldName: 'game_id' })
  public gameId!: string;

  @Property()
  public kind!: WagerTransactionKind;

  @Property({ fieldName: 'money_amount', type: 'numeric', precision: 19, scale: 2 })
  public moneyAmount!: string;

  @Property({ fieldName: 'money_currency', length: 3 })
  public moneyCurrency!: string;

  @Property({ fieldName: 'reference_external_transaction_id', nullable: true })
  public referenceExternalTransactionId?: string;

  @Property({ fieldName: 'reference_transaction_id', type: 'uuid', nullable: true })
  public referenceTransactionId?: string;

  @Property()
  public status!: WagerTransactionStatus;

  @Property({ fieldName: 'failure_code', nullable: true })
  public failureCode?: FailureCode;

  @Property({ fieldName: 'processed_at', nullable: true })
  public processedAt?: Date;

  @Property({ fieldName: 'pending_reference_attempts', type: 'integer' })
  public pendingReferenceAttempts: number = 0;

  @Property({ fieldName: 'next_reference_attempt_at', nullable: true })
  public nextReferenceAttemptAt?: Date;

  @Property({
    fieldName: 'balance_snapshot_amount',
    type: 'numeric',
    precision: 19,
    scale: 2,
    nullable: true,
  })
  public balanceSnapshotAmount?: string;

  @Property({ fieldName: 'created_at' })
  public createdAt: Date = new Date();
}
