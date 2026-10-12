import { Module } from '@nestjs/common';
import { SystemModule } from '../../infrastructure/system/system.module.js';
import { CreateWalletUseCase } from './create-wallet.use-case.js';
import { WalletQueryService } from './wallet-query.service.js';

@Module({
  imports: [SystemModule],
  providers: [CreateWalletUseCase, WalletQueryService],
  exports: [CreateWalletUseCase, WalletQueryService],
})
export class WalletModule {}
