import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { UddoktaPayGateway } from './gateways/uddoktapay.gateway';
import { PrismaModule } from '../core/prisma/prisma.module';

@Module({
  imports: [HttpModule, PrismaModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, UddoktaPayGateway],
  exports: [PaymentsService, UddoktaPayGateway],
})
export class PaymentsModule {}
