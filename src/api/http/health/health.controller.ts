import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';
import type { Response } from 'express';
import { SQS_CLIENT } from '../../../infrastructure/messaging/sqs/sqs.tokens.js';
import { sqsConfig } from '../../../infrastructure/config/wagering.config.js';
import { Public } from '../../../infrastructure/auth/public.decorator.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly orm: MikroORM,
    @Inject(SQS_CLIENT) private readonly sqsClient: SQSClient,
  ) {}

  @Get('live')
  public live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  public async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: string; checks: Record<string, boolean> }> {
    const [database, messaging] = await Promise.all([this.checkDatabase(), this.checkMessaging()]);
    const healthy = database && messaging;
    if (!healthy) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: healthy ? 'ok' : 'unavailable', checks: { database, messaging } };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.orm.em.getConnection().execute('select 1');
      return true;
    } catch {
      return false;
    }
  }

  private async checkMessaging(): Promise<boolean> {
    if (!sqsConfig.queueUrl) {
      return false;
    }
    try {
      await this.sqsClient.send(
        new GetQueueAttributesCommand({
          QueueUrl: sqsConfig.queueUrl,
          AttributeNames: ['QueueArn'],
        }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
