import { IsNotEmpty, IsString } from 'class-validator';

export class MoneyDto {
  @IsString()
  @IsNotEmpty()
  public amount!: string;

  @IsString()
  @IsNotEmpty()
  public currency!: string;
}
