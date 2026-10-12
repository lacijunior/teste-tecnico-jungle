import { Module } from '@nestjs/common';
import { SqsModule } from '../../../infrastructure/messaging/sqs/sqs.module.js';
import { HealthController } from './health.controller.js';
import { MetricsController } from './metrics.controller.js';

@Module({
  imports: [SqsModule],
  controllers: [HealthController, MetricsController],
})
export class HealthModule {}
