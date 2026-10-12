import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { Money } from '../../../domain/money/money.js';
import { CreateWalletUseCase } from '../../../application/wallet/create-wallet.use-case.js';
import {
  LedgerPageView,
  ReconciliationView,
  WalletQueryService,
  WalletView,
} from '../../../application/wallet/wallet-query.service.js';
import { CreateWalletDto } from './dto/create-wallet.dto.js';

const DEFAULT_LEDGER_LIMIT = 50;
const MAX_LEDGER_LIMIT = 200;

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly createWalletUseCase: CreateWalletUseCase,
    private readonly walletQueryService: WalletQueryService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public async create(@Body() dto: CreateWalletDto): Promise<WalletView> {
    const result = await this.createWalletUseCase.execute({
      playerId: dto.playerId,
      initialBalance: Money.from(dto.initialBalance),
    });
    return result;
  }

  @Get(':walletId')
  public async getById(@Param('walletId') walletId: string): Promise<WalletView> {
    return this.walletQueryService.getWallet(walletId);
  }

  @Get(':walletId/ledger')
  public async getLedger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<LedgerPageView> {
    const parsedLimit = Math.min(
      Number.parseInt(limit ?? '', 10) || DEFAULT_LEDGER_LIMIT,
      MAX_LEDGER_LIMIT,
    );
    return this.walletQueryService.getLedger(walletId, cursor, parsedLimit);
  }

  @Post(':walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  public async reconcile(@Param('walletId') walletId: string): Promise<ReconciliationView> {
    return this.walletQueryService.reconcile(walletId);
  }
}
