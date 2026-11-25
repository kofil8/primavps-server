import {
  Injectable,
  Logger,
  BadGatewayException,
  BadRequestException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PaymentGateway } from '@prisma/client';
import { firstValueFrom, catchError } from 'rxjs';
import { AxiosError } from 'axios';
import * as crypto from 'crypto';
import {
  IPaymentGateway,
  GatewayCreateInput,
  GatewayCreateResult,
  GatewayVerifyResult,
} from './payment-gateway.interface';

@Injectable()
export class UddoktaPayGateway implements IPaymentGateway {
  readonly provider = PaymentGateway.UDDOKTAPAY;
  private readonly logger = new Logger(UddoktaPayGateway.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly frontendUrl: string;
  private readonly backendUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.apiKey = this.configService.getOrThrow<string>('UDDOKTAPAY_API_KEY');
    this.baseUrl = this.configService.getOrThrow<string>('UDDOKTAPAY_BASE_URL');
    this.frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    this.backendUrl = this.configService.getOrThrow<string>('BACKEND_URL');
  }

  private getHeaders() {
    return {
      'RT-UDDOKTAPAY-API-KEY': this.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async createPayment(input: GatewayCreateInput): Promise<GatewayCreateResult> {
    const payload = {
      full_name: input.customerName,
      email: input.customerEmail,
      amount: input.amountBdt.toString(),
      metadata: {
        gateway_tran_id: input.gatewayTranId,
        invoice_number: input.invoiceNumber,
        ...input.metadata,
      },
      redirect_url: `${this.frontendUrl}/billing/payment/success`,
      return_type: 'GET',
      cancel_url: `${this.frontendUrl}/billing/payment/cancel`,
      webhook_url: `${this.backendUrl}/api/payments/webhook/uddoktapay`,
    };

    const { data } = await firstValueFrom(
      this.httpService
        .post(`${this.baseUrl}/checkout-v2`, payload, {
          headers: this.getHeaders(),
          timeout: 10000,
        })
        .pipe(
          catchError((err: AxiosError) => {
            this.logger.error(`UddoktaPay Create Error: ${JSON.stringify(err.response?.data || err.message)}`);
            throw new BadGatewayException('পেমেন্ট সেশন তৈরি করতে সমস্যা হয়েছে');
          }),
        ),
    );

    if (!data?.status || !data?.payment_url) {
      throw new BadRequestException(data?.message || 'UddoktaPay চেকআউট লিংক দেয়নি');
    }

    return {
      paymentUrl: data.payment_url,
      rawResponse: data,
    };
  }

  async verifyPayment(invoiceId: string): Promise<GatewayVerifyResult> {
    const { data } = await firstValueFrom(
      this.httpService
        .post(
          `${this.baseUrl}/verify-payment`,
          { invoice_id: invoiceId },
          { headers: this.getHeaders(), timeout: 10000 },
        )
        .pipe(
          catchError((err: AxiosError) => {
            this.logger.error(`UddoktaPay Verify Error [${invoiceId}]: ${JSON.stringify(err.response?.data || err.message)}`);
            throw new BadGatewayException('পেমেন্ট ভেরিফিকেশন ব্যর্থ হয়েছে');
          }),
        ),
    );

    return {
      isSuccess: data?.status === 'COMPLETED',
      gatewayTranId: data?.metadata?.gateway_tran_id,
      gatewayValId: data?.invoice_id || invoiceId,
      amountBdt: Math.round(Number(data?.amount || 0)),
      rawPayload: data,
    };
  }

  verifyWebhookSignature(incomingKey?: string): boolean {
    if (!incomingKey || incomingKey.length !== this.apiKey.length) return false;
    return crypto.timingSafeEqual(Buffer.from(incomingKey), Buffer.from(this.apiKey));
  }
}
