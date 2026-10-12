import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { AppWithoutBackgroundJobsModule } from '../../src/app-without-background-jobs.module.js';

export interface TestHttpApp {
  app: INestApplication;
  baseUrl: string;
}

export async function createTestHttpApp(
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<TestHttpApp> {
  const builder = Test.createTestingModule({ imports: [AppWithoutBackgroundJobsModule] });
  const moduleRef = await (configure ? configure(builder) : builder).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${address.port}` };
}
