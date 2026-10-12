import { Entity, Property } from '@mikro-orm/core';
import { InboxMessageRepository } from '../repositories/inbox-message.repository.js';

@Entity({ tableName: 'inbox_messages', repository: () => InboxMessageRepository })
export class InboxMessageEntity {
  @Property({ fieldName: 'consumer_name', primary: true })
  public consumerName!: string;

  @Property({ fieldName: 'message_id', primary: true })
  public messageId!: string;

  @Property({ fieldName: 'payload_hash' })
  public payloadHash!: string;

  @Property({ fieldName: 'received_at' })
  public receivedAt: Date = new Date();

  @Property({ fieldName: 'processed_at', nullable: true })
  public processedAt?: Date;
}
