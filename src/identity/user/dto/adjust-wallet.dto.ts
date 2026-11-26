import { IsInt, IsNotEmpty, IsString, MaxLength, MinLength, NotEquals } from 'class-validator';

export class AdjustWalletDto {
  @IsInt()
  @NotEquals(0, { message: 'amountDeltaBdt cannot be zero' })
  amountDeltaBdt!: number;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(255)
  reason!: string;
}
