import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { MoneyDto } from '../../common/money.dto.js';

export class CreateWalletDto {
  @IsString()
  @IsNotEmpty()
  public playerId!: string;

  @ValidateNested()
  @Type(() => MoneyDto)
  public initialBalance!: MoneyDto;
}
