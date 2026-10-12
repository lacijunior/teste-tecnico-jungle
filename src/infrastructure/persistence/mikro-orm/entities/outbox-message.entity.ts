import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core';
import { OutboxMessageRepository } from '../repositories/outbox-message.repository.js';

@Entity({ tableName: 'outbox_messages', repository: () => OutboxMessageRepository })
@Index({ properties: ['nextAttemptAt'] })
export class OutboxMessageEntity {
  @PrimaryKey({ type: 'uuid' })
  public id!: string;

  @Property({ fieldName: 'aggregate_id', type: 'uuid' })
  public aggregateId!: string;

  @Property({ fieldName: 'event_type' })
  public eventType!: string;

  @Property({ type: 'json' })
  public payload!: Record<string, unknown>;

  @Property({ fieldName: 'occurred_at' })
  public occurredAt!: Date;

  @Property({ type: 'integer' })
  public attempts: number = 0;

  @Property({ fieldName: 'next_attempt_at', nullable: true })
  public nextAttemptAt?: Date;

  @Property({ fieldName: 'published_at', nullable: true })
  public publishedAt?: Date;
}
