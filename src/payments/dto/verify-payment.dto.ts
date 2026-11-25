import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerifyUddoktaPayDto {
  @IsString()
  @IsNotEmpty({ message: 'Invoice ID প্রদান করা আবশ্যক' })
  @MaxLength(100)
  invoice_id!: string;
}

export class VerifyBkashDto {
  @IsString()
  @IsNotEmpty()
  paymentID!: string;
}
