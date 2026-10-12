import { Module } from '@nestjs/common';
import { CLOCK } from '../../application/ports/clock.js';
import { ID_GENERATOR } from '../../application/ports/id-generator.js';
import {
  WAGERING_METRICS,
  type WageringMetrics,
} from '../../application/ports/wagering-metrics.js';
import { WalletLockRetryPolicy } from '../../application/wallet/wallet-lock-retry-policy.js';
import { walletLockConfig } from '../config/wagering.config.js';
import { PromWageringMetrics } from '../observability/prom-wagering-metrics.js';
import { SystemClock } from './system-clock.js';
import { UuidGenerator } from './uuid-generator.js';

@Module({
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidGenerator },
    { provide: WAGERING_METRICS, useClass: PromWageringMetrics },
    {
      provide: WalletLockRetryPolicy,
      useFactory: (metrics: WageringMetrics) =>
        new WalletLockRetryPolicy(walletLockConfig, metrics),
      inject: [WAGERING_METRICS],
    },
  ],
  exports: [CLOCK, ID_GENERATOR, WAGERING_METRICS, WalletLockRetryPolicy],
})
export class SystemModule {}
