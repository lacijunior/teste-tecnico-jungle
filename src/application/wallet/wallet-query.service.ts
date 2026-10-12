import { EnsureRequestContext, MikroORM } from '@mikro-orm/core';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { MoneyProps } from '../../domain/money/money.js';
import { WalletEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet.entity.js';
import { WalletLedgerEntryEntity } from '../../infrastructure/persistence/mikro-orm/entities/wallet-ledger-entry.entity.js';
import { WalletRepository } from '../../infrastructure/persistence/mikro-orm/repositories/wallet.repository.js';
import { WalletLedgerEntryRepository } from '../../infrastructure/persistence/mikro-orm/repositories/wallet-ledger-entry.repository.js';
import { WalletNotFoundError } from '../wagering/wagering-application.errors.js';
import { WAGERING_METRICS, type WageringMetrics } from '../ports/wagering-metrics.js';

export interface WalletView {
  id: string;
  playerId: string;
  balance: MoneyProps;
  version: number;
}

export interface LedgerEntryView {
  id: string;
  transactionId: string;
  direction: string;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  createdAt: string;
}

export interface LedgerPageView {
  entries: LedgerEntryView[];
  nextCursor: string | undefined;
}

export interface ReconciliationView {
  walletId: string;
  storedBalance: MoneyProps;
  calculatedBalance: MoneyProps;
  difference: MoneyProps;
  consistent: boolean;
  checkedEntries: number;
}

@Injectable()
export class WalletQueryService {
  private readonly logger = new Logger(WalletQueryService.name);

  constructor(
    private readonly orm: MikroORM,
    @Inject(WAGERING_METRICS) private readonly metrics: WageringMetrics,
  ) {}

  @EnsureRequestContext()
  public async getWallet(walletId: string): Promise<WalletView> {
    const entity = await this.orm.em
      .getRepository<WalletEntity, WalletRepository>(WalletEntity)
      .findOne({ id: walletId });
    if (!entity) {
      throw new WalletNotFoundError(walletId);
    }
    return this.toView(entity);
  }

  @EnsureRequestContext()
  public async getLedger(
    walletId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<LedgerPageView> {
    const wallet = await this.orm.em
      .getRepository<WalletEntity, WalletRepository>(WalletEntity)
      .findOne({ id: walletId });
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    const page = await this.orm.em
      .getRepository<WalletLedgerEntryEntity, WalletLedgerEntryRepository>(WalletLedgerEntryEntity)
      .listByWallet(walletId, cursor, limit);

    return {
      entries: page.entries.map((entry) => ({
        id: entry.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: { amount: entry.moneyAmount, currency: entry.moneyCurrency },
        balanceBefore: { amount: entry.balanceBefore, currency: entry.moneyCurrency },
        balanceAfter: { amount: entry.balanceAfter, currency: entry.moneyCurrency },
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  @EnsureRequestContext()
  public async reconcile(walletId: string): Promise<ReconciliationView> {
    const wallet = await this.orm.em
      .getRepository<WalletEntity, WalletRepository>(WalletEntity)
      .findOne({ id: walletId });
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    const { amount: calculatedAmount, entries } = await this.orm.em
      .getRepository<WalletLedgerEntryEntity, WalletLedgerEntryRepository>(WalletLedgerEntryEntity)
      .calculateBalance(walletId);

    const stored = new Decimal(wallet.balanceAmount);
    const calculated = new Decimal(calculatedAmount);
    const consistent = stored.equals(calculated);

    if (!consistent) {
      this.metrics.recordReconciliationDivergence();
      this.logger.warn(
        `reconciliation mismatch for wallet ${walletId}: stored=${stored.toFixed(2)} calculated=${calculated.toFixed(2)}`,
      );
    }

    return {
      walletId,
      storedBalance: { amount: stored.toFixed(2), currency: wallet.currency },
      calculatedBalance: { amount: calculated.toFixed(2), currency: wallet.currency },
      difference: { amount: stored.minus(calculated).toFixed(2), currency: wallet.currency },
      consistent,
      checkedEntries: entries,
    };
  }

  private toView(entity: WalletEntity): WalletView {
    return {
      id: entity.id,
      playerId: entity.playerId,
      balance: { amount: entity.balanceAmount, currency: entity.currency },
      version: entity.version,
    };
  }
}
