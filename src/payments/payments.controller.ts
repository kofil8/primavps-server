import {
  Controller,
  Post,
  Body,
  Headers,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { PaymentGateway } from '@prisma/client';
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
    @Req() req: any,
    @Body() dto: InitiatePaymentDto & { userId?: string },
  ) {
    const userId = req.user?.id || dto.userId;
    return this.paymentsService.initiatePayment(
      userId,
      dto.invoiceId,
      dto.gateway ?? PaymentGateway.UDDOKTAPAY,
    );
  }


  @Post('verify/uddoktapay')
  @HttpCode(HttpStatus.OK)
  async verifyUddoktaPay(@Body() dto: VerifyUddoktaPayDto) {
    return this.paymentsService.verifyAndCompletePayment(
      PaymentGateway.UDDOKTAPAY,
      dto.invoice_id,
    );
  }

  @Post('webhook/uddoktapay')
  @HttpCode(HttpStatus.OK)
  async uddoktaPayWebhook(
    @Headers('rt-uddoktapay-api-key') headerApiKey: string,
    @Body() payload: { invoice_id?: string },
  ) {
    if (!this.uddoktaPayGateway.verifyWebhookSignature(headerApiKey)) {
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
