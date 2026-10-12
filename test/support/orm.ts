import { MikroORM } from '@mikro-orm/postgresql';
import ormConfig from '../../src/infrastructure/persistence/mikro-orm/orm-config.js';

export async function createTestOrm(): Promise<MikroORM> {
  return MikroORM.init(ormConfig);
}
