import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Inject, Injectable } from '@nestjs/common';
import type {
  MessagePublisher,
  PublishMessageParams,
} from '../../../application/ports/message-publisher.js';
import { SQS_CLIENT } from './sqs.tokens.js';

@Injectable()
export class SqsPublisherGateway implements MessagePublisher {
  constructor(@Inject(SQS_CLIENT) private readonly client: SQSClient) {}

  public async publish(params: PublishMessageParams): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: params.destination,
        MessageBody: params.body,
        MessageGroupId: params.partitionKey,
        MessageDeduplicationId: params.deduplicationKey,
      }),
    );
  }
}
