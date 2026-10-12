import { Module } from '@nestjs/common';
import { MESSAGE_PUBLISHER } from '../../../application/ports/message-publisher.js';
import { createSqsClient } from './sqs-client.factory.js';
import { SqsPublisherGateway } from './sqs-publisher.gateway.js';
import { SQS_CLIENT } from './sqs.tokens.js';

@Module({
  providers: [
    { provide: SQS_CLIENT, useFactory: createSqsClient },
    { provide: MESSAGE_PUBLISHER, useClass: SqsPublisherGateway },
  ],
  exports: [SQS_CLIENT, MESSAGE_PUBLISHER],
})
export class SqsModule {}
