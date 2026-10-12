import { Module } from '@nestjs/common';
import { SqsModule } from '../messaging/sqs/sqs.module.js';
import { SystemModule } from '../system/system.module.js';
import { OutboxPublisherWorker } from './outbox-publisher.worker.js';
import { PendingReferenceReprocessorWorker } from './pending-reference-reprocessor.worker.js';

@Module({
  imports: [SqsModule, SystemModule],
  providers: [OutboxPublisherWorker, PendingReferenceReprocessorWorker],
})
export class WorkersModule {}
