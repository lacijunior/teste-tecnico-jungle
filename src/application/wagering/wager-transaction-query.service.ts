import { EnsureRequestContext, MikroORM } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';
import type { FailureCode } from '../../domain/wagering/failure-code.js';
import type { MoneyProps } from '../../domain/money/money.js';
import { WagerTransactionEntity } from '../../infrastructure/persistence/mikro-orm/entities/wager-transaction.entity.js';
import { WagerTransactionRepository } from '../../infrastructure/persistence/mikro-orm/repositories/wager-transaction.repository.js';

export class WagerTransactionNotFoundError extends Error {
  constructor(identifier: string) {
    super(`wager transaction ${identifier} was not found`);
  }
}

export interface WagerTransactionView {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  kind: string;
  status: string;
  money: MoneyProps;
  failureCode: FailureCode | undefined;
  referenceTransactionId: string | undefined;
  createdAt: string;
  processedAt: string | undefined;
}

@Injectable()
export class WagerTransactionQueryService {
  constructor(private readonly orm: MikroORM) {}

  @EnsureRequestContext()
  public async getById(transactionId: string): Promise<WagerTransactionView> {
    const entity = await this.orm.em
      .getRepository<WagerTransactionEntity, WagerTransactionRepository>(WagerTransactionEntity)
      .findOne({ id: transactionId });
    if (!entity) {
      throw new WagerTransactionNotFoundError(transactionId);
    }
    return this.toView(entity);
  }

  @EnsureRequestContext()
  public async getByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionView> {
    const entity = await this.orm.em
      .getRepository<WagerTransactionEntity, WagerTransactionRepository>(WagerTransactionEntity)
      .findByProviderAndExternalId(providerId, externalTransactionId);
    if (!entity) {
      throw new WagerTransactionNotFoundError(`${providerId}:${externalTransactionId}`);
    }
    return this.toView(entity);
  }

  private toView(entity: WagerTransactionEntity): WagerTransactionView {
    return {
      transactionId: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      walletId: entity.walletId,
      kind: entity.kind,
      status: entity.status,
      money: { amount: entity.moneyAmount, currency: entity.moneyCurrency },
      failureCode: entity.failureCode,
      referenceTransactionId: entity.referenceTransactionId,
      createdAt: entity.createdAt.toISOString(),
      processedAt: entity.processedAt?.toISOString(),
    };
  }
}
