import { OutboxMessage } from '../../../../domain/messaging/outbox-message.js';
import { OutboxMessageEntity } from '../entities/outbox-message.entity.js';

export class OutboxMessageMapper {
  public static toDomain(entity: OutboxMessageEntity): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: entity.id,
      aggregateId: entity.aggregateId,
      eventType: entity.eventType,
      payload: entity.payload,
      occurredAt: entity.occurredAt,
      attempts: entity.attempts,
      nextAttemptAt: entity.nextAttemptAt,
      publishedAt: entity.publishedAt,
    });
  }

  public static toNewEntity(message: OutboxMessage): OutboxMessageEntity {
    const entity = new OutboxMessageEntity();
    entity.id = message.id;
    entity.aggregateId = message.aggregateId;
    entity.eventType = message.eventType;
    entity.payload = message.payload as Record<string, unknown>;
    entity.occurredAt = message.occurredAt;
    this.applyMutableFields(message, entity);
    return entity;
  }

  public static applyMutableFields(message: OutboxMessage, entity: OutboxMessageEntity): void {
    entity.attempts = message.attempts;
    entity.nextAttemptAt = message.nextAttemptAt;
    entity.publishedAt = message.publishedAt;
  }
}
