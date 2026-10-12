import { Module } from '@nestjs/common';
import { WageringModule } from '../../../application/wagering/wagering.module.js';
import { SystemModule } from '../../system/system.module.js';
import { SqsConsumerAdapter } from './sqs-consumer.adapter.js';
import { SqsModule } from './sqs.module.js';

@Module({
  imports: [SqsModule, WageringModule, SystemModule],
  providers: [SqsConsumerAdapter],
})
export class SqsConsumerModule {}
