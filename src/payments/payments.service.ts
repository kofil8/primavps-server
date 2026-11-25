import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  PaymentGateway,
  InvoiceStatus,
  OrderStatus,
  TransactionStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
// আপনার প্রজেক্টের PrismaService পাথ অনুযায়ী ইম্পোর্ট ঠিক করে নিন (যেমন: ../core/prisma/prisma.service)
import { PrismaService } from '../core/prisma/prisma.service';
import { UddoktaPayGateway } from './gateways/uddoktapay.gateway';
import { IPaymentGateway } from './gateways/payment-gateway.interface';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly gateways: Map<PaymentGateway, IPaymentGateway>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uddoktaPayGateway: UddoktaPayGateway,
  ) {
    // ভবিষ্যতে এখানে শুধু BKASH, NAGAD, SSLCOMMERZ রেজিস্টার করবেন
    this.gateways = new Map<PaymentGateway, IPaymentGateway>([
      [PaymentGateway.UDDOKTAPAY, this.uddoktaPayGateway],
    ]);
  }

  private getGateway(provider: PaymentGateway): IPaymentGateway {
    const gateway = this.gateways.get(provider);
    if (!gateway) {
      throw new BadRequestException(`${provider} পেমেন্ট গেটওয়ে এখনো সক্রিয় নয়`);
    }
    return gateway;
  }

  // ১. ইনভয়েসের বিপরীতে পেমেন্ট শুরু করা
  async initiatePayment(userId: string, invoiceId: string, provider: PaymentGateway) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, userId },
      include: { user: true, order: true },
    });

    if (!invoice) {
      throw new NotFoundException('ইনভয়েস খুঁজে পাওয়া যায়নি');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('এই ইনভয়েসটি ইতিমধ্যে পরিশোধ করা হয়েছে');
    }

    const gateway = this.getGateway(provider);
    const gatewayTranId = `TXN-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

    // ডাটাবেসে INITIATED ট্রানজেকশন রেকর্ড তৈরি
    const transaction = await this.prisma.paymentTransaction.create({
      data: {
        invoiceId: invoice.id,
        gateway: provider,
        gatewayTranId,
        amountBdt: invoice.amountBdt,
        status: TransactionStatus.INITIATED,
      },
    });

    const session = await gateway.createPayment({
      gatewayTranId,
      amountBdt: invoice.amountBdt,
      customerName: `${invoice.user.firstName} ${invoice.user.lastName}`,
      customerEmail: invoice.user.email,
      customerPhone: invoice.user.phone ?? undefined,
      invoiceNumber: invoice.invoiceNumber,
      metadata: {
        invoiceId: invoice.id,
        orderId: invoice.orderId,
      },
    });

    await this.prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: TransactionStatus.PENDING,
        rawPayload: session.rawResponse,
      },
    });

    return {
      paymentUrl: session.paymentUrl,
      gatewayTranId,
    };
  }

  // ২. পেমেন্ট ভেরিফাই ও ডাটাবেস আপডেট (Idempotent)
  async verifyAndCompletePayment(provider: PaymentGateway, referenceId: string) {
    const gateway = this.getGateway(provider);
    const result = await gateway.verifyPayment(referenceId);

    if (!result.gatewayTranId) {
      throw new BadRequestException('ট্রানজেকশন রেফারেন্স পাওয়া যায়নি');
    }

    const tx = await this.prisma.paymentTransaction.findUnique({
      where: { gatewayTranId: result.gatewayTranId },
      include: { invoice: true },
    });

    if (!tx) {
      throw new NotFoundException('সিস্টেমে এই ট্রানজেকশনটি পাওয়া যায়নি');
    }

    // Idempotency Check: আগে থেকেই VALIDATED হলে দ্বিতীয়বার প্রসেস করবে না
    if (tx.status === TransactionStatus.VALIDATED) {
      return { status: 'ALREADY_PAID', invoiceId: tx.invoiceId };
    }

    if (!result.isSuccess) {
      await this.prisma.paymentTransaction.update({
        where: { id: tx.id },
        data: {
          status: TransactionStatus.FAILED,
          gatewayValId: result.gatewayValId,
          rawPayload: result.rawPayload,
        },
      });
      return { status: 'FAILED', invoiceId: tx.invoiceId };
    }

    // Security Check: পেইড অ্যামাউন্ট ও ইনভয়েস অ্যামাউন্ট মিলিয়ে দেখা
    if (result.amountBdt < tx.amountBdt) {
      this.logger.error(`Amount mismatch for ${tx.gatewayTranId}: expected ${tx.amountBdt}, got ${result.amountBdt}`);
      throw new BadRequestException('পরিশোধিত টাকার পরিমাণ ইনভয়েসের সাথে মিলছে না');
    }

    // Atomic Transaction: Transaction, Invoice, Order ও AuditLog একসাথে আপডেট
    await this.prisma.$transaction(async (prismaTx) => {
      await prismaTx.paymentTransaction.update({
        where: { id: tx.id },
        data: {
          status: TransactionStatus.VALIDATED,
          gatewayValId: result.gatewayValId,
          rawPayload: result.rawPayload,
        },
      });

      const updatedInvoice = await prismaTx.invoice.update({
        where: { id: tx.invoiceId },
        data: {
          status: InvoiceStatus.PAID,
          paidAt: new Date(),
        },
      });

      if (updatedInvoice.orderId) {
        await prismaTx.order.update({
          where: { id: updatedInvoice.orderId },
          data: { status: OrderStatus.PAID },
        });
      }

      await prismaTx.auditLog.create({
        data: {
          actorId: updatedInvoice.userId,
          action: 'ORDER_PAID',
          entity: 'Invoice',
          entityId: updatedInvoice.id,
          metadata: {
            gateway: provider,
            gatewayTranId: tx.gatewayTranId,
            gatewayValId: result.gatewayValId,
            amountBdt: result.amountBdt,
          },
        },
      });
    });

    // TODO: এখানে আপনার Proxmox VPS Provisioning Queue/Event ট্রিগার করুন

    return {
      status: 'COMPLETED',
      invoiceId: tx.invoiceId,
      orderId: tx.invoice.orderId,
    };
  }
}
