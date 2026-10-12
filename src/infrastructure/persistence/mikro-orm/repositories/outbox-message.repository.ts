import { EntityRepository } from '@mikro-orm/postgresql';
import type { OutboxMessageEntity } from '../entities/outbox-message.entity.js';

export class OutboxMessageRepository extends EntityRepository<OutboxMessageEntity> {
  public async claimDueBatch(now: Date, limit: number): Promise<OutboxMessageEntity[]> {
    const connection = this.getEntityManager().getConnection();
    const rows = await connection.execute<Array<{ id: string }>>(
      `select id from outbox_messages
       where published_at is null and (next_attempt_at is null or next_attempt_at <= ?)
       order by occurred_at
       limit ?
       for update skip locked`,
      [now, limit],
    );
    if (rows.length === 0) {
      return [];
    }
    const entities = await this.find({ id: { $in: rows.map((row) => row.id) } });
    // `find()` with `$in` does not preserve the order of the id list — reorder explicitly so
    // callers can rely on the `occurred_at` order the raw query above already established.
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    return rows
      .map((row) => byId.get(row.id))
      .filter((entity): entity is OutboxMessageEntity => entity !== undefined);
  }
}
