import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Money } from '../../../domain/money/money.js';
import { WagerTransactionStatus } from '../../../domain/wagering/wager-transaction-status.js';
import {
  SubmitWagerTransactionResult,
  SubmitWagerTransactionUseCase,
} from '../../../application/wagering/submit-wager-transaction.use-case.js';
import {
  WagerTransactionQueryService,
  WagerTransactionView,
} from '../../../application/wagering/wager-transaction-query.service.js';
import { SubmitWagerTransactionDto } from './dto/submit-wager-transaction.dto.js';

const STATUS_TO_HTTP_STATUS: Record<WagerTransactionStatus, number> = {
  [WagerTransactionStatus.Pending]: HttpStatus.ACCEPTED,
  [WagerTransactionStatus.PendingReference]: HttpStatus.ACCEPTED,
  [WagerTransactionStatus.Processed]: HttpStatus.CREATED,
  [WagerTransactionStatus.Rejected]: HttpStatus.UNPROCESSABLE_ENTITY,
  [WagerTransactionStatus.Failed]: HttpStatus.SERVICE_UNAVAILABLE,
};

@Controller()
export class WageringController {
  constructor(
    private readonly submitWagerTransactionUseCase: SubmitWagerTransactionUseCase,
    private readonly wagerTransactionQueryService: WagerTransactionQueryService,
  ) {}

  @Post('wagering/transactions')
  public async submit(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: SubmitWagerTransactionDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SubmitWagerTransactionResult> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const result = await this.submitWagerTransactionUseCase.execute({
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      idempotencyKey,
      playerId: dto.playerId,
      walletId: dto.walletId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind,
      money: Money.from(dto.money),
      referenceExternalTransactionId: dto.referenceExternalTransactionId,
    });

    const isReplayOfCompletedWork =
      result.idempotentReplay && result.status === WagerTransactionStatus.Processed;
    res.status(isReplayOfCompletedWork ? HttpStatus.OK : STATUS_TO_HTTP_STATUS[result.status]);
    return result;
  }

  @Get('wagering/transactions/:transactionId')
  public async getById(
    @Param('transactionId') transactionId: string,
  ): Promise<WagerTransactionView> {
    return this.wagerTransactionQueryService.getById(transactionId);
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  public async getByProviderAndExternalId(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ): Promise<WagerTransactionView> {
    return this.wagerTransactionQueryService.getByProviderAndExternalId(
      providerId,
      externalTransactionId,
    );
  }
}
