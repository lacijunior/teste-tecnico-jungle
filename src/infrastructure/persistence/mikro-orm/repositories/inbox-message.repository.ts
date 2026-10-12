import { EntityRepository } from '@mikro-orm/postgresql';
import type { InboxMessageEntity } from '../entities/inbox-message.entity.js';

export class InboxMessageRepository extends EntityRepository<InboxMessageEntity> {
  public async findByConsumerAndMessage(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessageEntity | null> {
    return this.findOne({ consumerName, messageId });
  }
}
