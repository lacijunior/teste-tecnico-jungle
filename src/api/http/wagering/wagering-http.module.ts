import { Module } from '@nestjs/common';
import { WageringModule } from '../../../application/wagering/wagering.module.js';
import { WageringController } from './wagering.controller.js';

@Module({
  imports: [WageringModule],
  controllers: [WageringController],
})
export class WageringHttpModule {}
