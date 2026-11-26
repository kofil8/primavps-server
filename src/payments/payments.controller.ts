import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PaymentGateway } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PaymentsService } from './payments.service';
import { UddoktaPayGateway } from './gateways/uddoktapay.gateway';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { VerifyUddoktaPayDto } from './dto/verify-payment.dto';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly uddoktaPayGateway: UddoktaPayGateway,
  ) {}

  @Post('initiate')
  async initiate(
    @CurrentUser('sub') userId: string,
    @Body() dto: InitiatePaymentDto,
  ) {
    return this.paymentsService.initiatePayment(
      userId,
      dto.invoiceId,
      dto.gateway ?? PaymentGateway.UDDOKTAPAY,
    );
  }

  @Post('verify/uddoktapay')
  @HttpCode(HttpStatus.OK)
  async verifyUddoktaPay(
    @CurrentUser('sub') userId: string,
    @Body() dto: VerifyUddoktaPayDto,
  ) {
    return this.paymentsService.verifyAndCompletePayment(
      PaymentGateway.UDDOKTAPAY,
      dto.invoice_id,
      userId,
    );
  }

  @Get('transactions/:gatewayTranId')
  async getTransactionStatus(
    @CurrentUser('sub') userId: string,
    @Param('gatewayTranId') gatewayTranId: string,
  ) {
    return this.paymentsService.getTransactionStatus(userId, gatewayTranId);
  }

  @Get('invoices/:invoiceId/transactions')
  async getInvoiceTransactions(
    @CurrentUser('sub') userId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
  ) {
    return this.paymentsService.getInvoiceTransactions(userId, invoiceId);
  }

  @Public()
  @SkipThrottle()
  @Post('webhook/uddoktapay')
  @HttpCode(HttpStatus.OK)
  async uddoktaPayWebhook(
    @Headers('rt-uddoktapay-api-key') headerApiKey: string | string[] | undefined,
    @Body() payload: { invoice_id?: string },
  ) {
    const normalizedKey = Array.isArray(headerApiKey)
      ? headerApiKey[0]
      : headerApiKey;

    if (!this.uddoktaPayGateway.verifyWebhookSignature(normalizedKey)) {
      throw new UnauthorizedException('Invalid UddoktaPay Webhook Key');
    }

    if (payload?.invoice_id) {
      await this.paymentsService.verifyAndCompletePayment(
        PaymentGateway.UDDOKTAPAY,
        payload.invoice_id,
      );
    }

    return { received: true };
  }
}
