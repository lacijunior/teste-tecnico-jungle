import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import {
  EXTERNALLY_SUBMITTABLE_KINDS,
  WagerTransactionKind,
} from '../../../../domain/wagering/wager-transaction-kind.js';
import { MoneyDto } from '../../common/money.dto.js';

export class SubmitWagerTransactionDto {
  @IsString()
  @IsNotEmpty()
  public providerId!: string;

  @IsString()
  @IsNotEmpty()
  public externalTransactionId!: string;

  @IsString()
  @IsNotEmpty()
  public playerId!: string;

  @IsString()
  @IsNotEmpty()
  public walletId!: string;

  @IsString()
  @IsNotEmpty()
  public roundId!: string;

  @IsString()
  @IsNotEmpty()
  public gameId!: string;

  @IsIn(EXTERNALLY_SUBMITTABLE_KINDS)
  public kind!: WagerTransactionKind;

  @ValidateNested()
  @Type(() => MoneyDto)
  public money!: MoneyDto;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  public referenceExternalTransactionId?: string;
}
