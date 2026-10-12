import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req) => {
          const headerValue = req.headers['x-correlation-id'];
          return (Array.isArray(headerValue) ? headerValue[0] : headerValue) ?? randomUUID();
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers["idempotency-key"]',
            '*.money',
            '*.balance',
            '*.balanceBefore',
            '*.balanceAfter',
            '*.initialBalance',
          ],
          censor: '[REDACTED]',
        },
        autoLogging: false,
      },
    }),
  ],
  exports: [LoggerModule],
})
export class ObservabilityModule {}
