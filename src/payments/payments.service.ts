import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  PaymentGateway,
  InvoiceStatus,
  OrderStatus,
  TransactionStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../core/prisma/prisma.service';
import { UddoktaPayGateway } from './gateways/uddoktapay.gateway';
import { IPaymentGateway } from './gateways/payment-gateway.interface';
import {
  PAYMENT_COMPLETED_EVENT,
  PaymentCompletedEvent,
} from './events/payment-completed.event';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly gateways: Map<PaymentGateway, IPaymentGateway>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly uddoktaPayGateway: UddoktaPayGateway,
    @Optional() private readonly eventEmitter?: EventEmitter2,
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

    if (
      invoice.status === InvoiceStatus.CANCELLED ||
      invoice.status === InvoiceStatus.REFUNDED
    ) {
      throw new BadRequestException('এই ইনভয়েসটি আর পরিশোধযোগ্য নয়');
    }

    if (invoice.amountBdt <= 0) {
      throw new BadRequestException('ইনভয়েসের টাকার পরিমাণ সঠিক নয়');
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

    try {
      const session = await gateway.createPayment({
        gatewayTranId,
        amountBdt: invoice.amountBdt,
        customerName: `${invoice.user.firstName} ${invoice.user.lastName}`.trim(),
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
          gatewayValId: session.gatewayPaymentId ?? null,
          rawPayload: session.rawResponse,
        },
      });

      return {
        paymentUrl: session.paymentUrl,
        gatewayTranId,
      };
    } catch (error) {
      await this.prisma.paymentTransaction
        .update({
          where: { id: transaction.id },
          data: { status: TransactionStatus.FAILED },
        })
        .catch((err) =>
          this.logger.warn(`Failed to mark initiated tx ${transaction.id} as FAILED: ${err}`),
        );
      throw error;
    }
  }

  // ২. পেমেন্ট ভেরিফাই ও ডাটাবেস আপডেট (Concurrency-Safe & Idempotent)
  async verifyAndCompletePayment(
    provider: PaymentGateway,
    referenceId: string,
    requestingUserId?: string,
  ) {
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

    if (requestingUserId && tx.invoice.userId !== requestingUserId) {
      throw new ForbiddenException('এই ট্রানজেকশনটি ভেরিফাই করার অনুমতি নেই');
    }

    // Idempotency Check: আগে থেকেই VALIDATED বা Invoice PAID হলে দ্বিতীয়বার প্রসেস করবে না
    if (
      tx.status === TransactionStatus.VALIDATED ||
      tx.invoice?.status === InvoiceStatus.PAID
    ) {
      return {
        status: 'ALREADY_PAID',
        invoiceId: tx.invoiceId,
        orderId: tx.invoice?.orderId ?? null,
      };
    }

    if (result.isPending) {
      return {
        status: 'PENDING',
        invoiceId: tx.invoiceId,
      };
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
      this.logger.error(
        `Amount mismatch for ${tx.gatewayTranId}: expected ${tx.amountBdt}, got ${result.amountBdt}`,
      );
      throw new BadRequestException('পরিশোধিত টাকার পরিমাণ ইনভয়েসের সাথে মিলছে না');
    }

    // Atomic Transaction: Concurrency-safe claim + Transaction, Invoice, Order ও AuditLog আপডেট
    const outcome = await this.prisma.$transaction(async (prismaTx) => {
      const txClaim = await prismaTx.paymentTransaction.updateMany({
        where: {
          id: tx.id,
          status: { in: [TransactionStatus.INITIATED, TransactionStatus.PENDING] },
        },
        data: {
          status: TransactionStatus.VALIDATED,
          gatewayValId: result.gatewayValId,
          rawPayload: result.rawPayload,
        },
      });

      if (txClaim.count === 0) {
        return { alreadyPaid: true as const };
      }

      const invoiceClaim = await prismaTx.invoice.updateMany({
        where: {
          id: tx.invoiceId,
          status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.OVERDUE] },
        },
        data: {
          status: InvoiceStatus.PAID,
          paidAt: new Date(),
        },
      });

      if (invoiceClaim.count === 0) {
        return { alreadyPaid: true as const };
      }

      if (tx.invoice.orderId) {
        await prismaTx.order.updateMany({
          where: {
            id: tx.invoice.orderId,
            status: OrderStatus.PENDING_PAYMENT,
          },
          data: { status: OrderStatus.PAID },
        });
      }

      await prismaTx.auditLog.create({
        data: {
          actorId: tx.invoice.userId,
          action: 'ORDER_PAID',
          entity: 'Invoice',
          entityId: tx.invoiceId,
          metadata: {
            gateway: provider,
            gatewayTranId: tx.gatewayTranId,
            gatewayValId: result.gatewayValId,
            amountBdt: result.amountBdt,
          },
        },
      });

      return {
        alreadyPaid: false as const,
        userId: tx.invoice.userId,
        orderId: tx.invoice.orderId ?? null,
      };
    });

    if (outcome.alreadyPaid) {
      return {
        status: 'ALREADY_PAID',
        invoiceId: tx.invoiceId,
        orderId: tx.invoice?.orderId ?? null,
      };
    }

    // Decoupled domain event for Proxmox VPS provisioning, confirmation emails, etc.
    this.eventEmitter?.emit(
      PAYMENT_COMPLETED_EVENT,
      new PaymentCompletedEvent(
        tx.invoiceId,
        outcome.orderId,
        outcome.userId,
        provider,
        tx.gatewayTranId,
        result.gatewayValId,
        result.amountBdt,
      ),
    );

    return {
      status: 'COMPLETED',
      invoiceId: tx.invoiceId,
      orderId: outcome.orderId,
    };
  }

  // ৩. ট্রানজেকশন স্ট্যাটাস দেখা (Frontend polling / checkout success page)
  async getTransactionStatus(userId: string, gatewayTranId: string) {
    const tx = await this.prisma.paymentTransaction.findUnique({
      where: { gatewayTranId },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            userId: true,
            orderId: true,
            status: true,
            paidAt: true,
          },
        },
      },
    });

    if (!tx || tx.invoice.userId !== userId) {
      throw new NotFoundException('ট্রানজেকশন খুঁজে পাওয়া যায়নি');
    }

    return {
      gatewayTranId: tx.gatewayTranId,
      gateway: tx.gateway,
      status: tx.status,
      amountBdt: tx.amountBdt,
      currency: tx.currency,
      invoiceId: tx.invoice.id,
      invoiceNumber: tx.invoice.invoiceNumber,
      invoiceStatus: tx.invoice.status,
      orderId: tx.invoice.orderId,
      paidAt: tx.invoice.paidAt,
      createdAt: tx.createdAt,
    };
  }

  // ৪. নির্দিষ্ট ইনভয়েসের সকল পেমেন্ট ট্রানজেকশন দেখা
  async getInvoiceTransactions(userId: string, invoiceId: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, userId },
      select: {
        id: true,
        invoiceNumber: true,
        orderId: true,
        amountBdt: true,
        status: true,
        paidAt: true,
        transactions: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            gateway: true,
            gatewayTranId: true,
            gatewayValId: true,
            amountBdt: true,
            currency: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException('ইনভয়েস খুঁজে পাওয়া যায়নি');
    }

    return invoice;
  }
}
