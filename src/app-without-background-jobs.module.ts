import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './infrastructure/auth/auth.module.js';
import { PersistenceModule } from './infrastructure/persistence/mikro-orm/mikro-orm.module.js';
import { SqsModule } from './infrastructure/messaging/sqs/sqs.module.js';
import { WalletsHttpModule } from './api/http/wallets/wallets.module.js';
import { WageringHttpModule } from './api/http/wagering/wagering-http.module.js';
import { HealthModule } from './api/http/health/health.module.js';
import { DomainExceptionFilter } from './api/http/common/domain-exception.filter.js';

@Module({
  imports: [
    AuthModule,
    PersistenceModule,
    SqsModule,
    WalletsHttpModule,
    WageringHttpModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppWithoutBackgroundJobsModule {}
