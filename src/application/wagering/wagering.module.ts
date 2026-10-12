import { Module } from '@nestjs/common';
import { SystemModule } from '../../infrastructure/system/system.module.js';
import { SubmitWagerTransactionUseCase } from './submit-wager-transaction.use-case.js';
import { WagerTransactionQueryService } from './wager-transaction-query.service.js';

@Module({
  imports: [SystemModule],
  providers: [SubmitWagerTransactionUseCase, WagerTransactionQueryService],
  exports: [SubmitWagerTransactionUseCase, WagerTransactionQueryService],
})
export class WageringModule {}
