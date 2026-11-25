import { IsEnum, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { PaymentGateway } from '@prisma/client';

export class InitiatePaymentDto {
  @IsUUID()
  @IsNotEmpty()
  invoiceId!: string;

  @IsEnum(PaymentGateway)
  @IsOptional()
  gateway?: PaymentGateway = PaymentGateway.UDDOKTAPAY;
}
