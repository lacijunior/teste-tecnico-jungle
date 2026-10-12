import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import { AppModule } from '../../src/app.module.js';
import { AppWithoutBackgroundJobsModule } from '../../src/app-without-background-jobs.module.js';

export async function createTestApp(
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<INestApplicationContext> {
  const builder = Test.createTestingModule({ imports: [AppWithoutBackgroundJobsModule] });
  const moduleRef = await (configure ? configure(builder) : builder).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

export async function createFullTestApp(
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<INestApplicationContext> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  const moduleRef = await (configure ? configure(builder) : builder).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}
