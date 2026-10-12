import { Module } from '@nestjs/common';
import { WalletModule } from '../../../application/wallet/wallet.module.js';
import { WalletsController } from './wallets.controller.js';

@Module({
  imports: [WalletModule],
  controllers: [WalletsController],
})
export class WalletsHttpModule {}
