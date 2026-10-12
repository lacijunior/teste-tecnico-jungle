import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { MikroORM } from '@mikro-orm/postgresql';
import { WalletEntity } from '../../../src/infrastructure/persistence/mikro-orm/entities/wallet.entity.js';
import { createTestOrm } from '../../support/orm.js';

describe('WalletEntity mapping', () => {
  let orm: MikroORM;

  beforeAll(async () => {
    orm = await createTestOrm();
  });

  afterAll(async () => {
    await orm.close();
  });

  it('persists an explicitly assigned updatedAt instead of overwriting it with the wall-clock time', async () => {
    const em = orm.em.fork();
    const walletId = randomUUID();
    const entity = new WalletEntity();
    entity.id = walletId;
    entity.playerId = randomUUID();
    entity.currency = 'BRL';
    entity.balanceAmount = '100.00';
    entity.createdAt = new Date('2026-01-01T00:00:00Z');
    entity.updatedAt = new Date('2026-01-01T00:00:00Z');
    em.persist(entity);
    await em.flush();

    const deterministicUpdatedAt = new Date('2030-06-15T10:00:00Z');
    entity.balanceAmount = '75.00';
    entity.updatedAt = deterministicUpdatedAt;
    await em.flush();

    const fresh = await orm.em.fork().getRepository(WalletEntity).findOneOrFail({ id: walletId });
    expect(fresh.updatedAt.toISOString()).toBe(deterministicUpdatedAt.toISOString());
  });
});
