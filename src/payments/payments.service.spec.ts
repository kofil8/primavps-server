import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  PaymentGateway,
  InvoiceStatus,
  OrderStatus,
  TransactionStatus,
} from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { UddoktaPayGateway } from './gateways/uddoktapay.gateway';
import {
  PAYMENT_COMPLETED_EVENT,
  PaymentCompletedEvent,
} from './events/payment-completed.event';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: any;
  let uddoktaPayGateway: jest.Mocked<UddoktaPayGateway>;
  let eventEmitter: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      invoice: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      order: {
        updateMany: jest.fn(),
      },
      paymentTransaction: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(prisma)),
    };

    const mockUddoktaPayGateway = {
      provider: PaymentGateway.UDDOKTAPAY,
      createPayment: jest.fn(),
      verifyPayment: jest.fn(),
    };

    eventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UddoktaPayGateway, useValue: mockUddoktaPayGateway },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    uddoktaPayGateway = module.get(UddoktaPayGateway);
  });

  describe('initiatePayment', () => {
    it('should throw NotFoundException if invoice does not exist', async () => {
      prisma.invoice.findFirst.mockResolvedValue(null);

      await expect(
        service.initiatePayment('user-1', 'inv-1', PaymentGateway.UDDOKTAPAY),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if invoice is already PAID', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        status: InvoiceStatus.PAID,
      });

      await expect(
        service.initiatePayment('user-1', 'inv-1', PaymentGateway.UDDOKTAPAY),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if invoice is CANCELLED', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        status: InvoiceStatus.CANCELLED,
      });

      await expect(
        service.initiatePayment('user-1', 'inv-1', PaymentGateway.UDDOKTAPAY),
      ).rejects.toThrow(BadRequestException);
    });

    it('should mark transaction FAILED if gateway createPayment throws', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        orderId: 'ord-1',
        invoiceNumber: 'INV-2026-001',
        amountBdt: 1500,
        status: InvoiceStatus.OVERDUE,
        user: {
          firstName: 'Rahim',
          lastName: 'Uddin',
          email: 'rahim@example.com',
          phone: '01700000000',
        },
      });
      prisma.paymentTransaction.create.mockResolvedValue({ id: 'tx-1' });
      prisma.paymentTransaction.update.mockResolvedValue({ id: 'tx-1' });
      uddoktaPayGateway.createPayment.mockRejectedValue(new Error('Gateway down'));

      await expect(
        service.initiatePayment('user-1', 'inv-1', PaymentGateway.UDDOKTAPAY),
      ).rejects.toThrow('Gateway down');

      expect(prisma.paymentTransaction.update).toHaveBeenCalledWith({
        where: { id: 'tx-1' },
        data: { status: TransactionStatus.FAILED },
      });
    });

    it('should create transaction and return checkout URL for UNPAID or OVERDUE invoice', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-1',
        orderId: 'ord-1',
        invoiceNumber: 'INV-2026-001',
        amountBdt: 1500,
        status: InvoiceStatus.UNPAID,
        user: {
          firstName: 'Rahim',
          lastName: 'Uddin',
          email: 'rahim@example.com',
          phone: '01700000000',
        },
      });

      prisma.paymentTransaction.create.mockResolvedValue({ id: 'tx-1' });
      uddoktaPayGateway.createPayment.mockResolvedValue({
        paymentUrl: 'https://uddoktapay.com',
        gatewayPaymentId: 'UP-INV-1',
        rawResponse: { status: true },
      });

      const result = await service.initiatePayment(
        'user-1',
        'inv-1',
        PaymentGateway.UDDOKTAPAY,
      );

      expect(prisma.paymentTransaction.create).toHaveBeenCalled();
      expect(prisma.paymentTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tx-1' },
          data: expect.objectContaining({
            status: TransactionStatus.PENDING,
            gatewayValId: 'UP-INV-1',
          }),
        }),
      );
      expect(result.paymentUrl).toBe('https://uddoktapay.com');
      expect(result.gatewayTranId).toMatch(/^TXN-/);
    });
  });

  describe('verifyAndCompletePayment', () => {
    it('should throw ForbiddenException if requestingUserId does not own the invoice', async () => {
      uddoktaPayGateway.verifyPayment.mockResolvedValue({
        isSuccess: true,
        gatewayTranId: 'TXN-100',
        gatewayValId: 'UP-999',
        amountBdt: 1500,
        rawPayload: {},
      });

      prisma.paymentTransaction.findUnique.mockResolvedValue({
        id: 'tx-1',
        invoiceId: 'inv-1',
        status: TransactionStatus.PENDING,
        invoice: { userId: 'other-user', orderId: 'ord-1', status: InvoiceStatus.UNPAID },
      });

      await expect(
        service.verifyAndCompletePayment(
          PaymentGateway.UDDOKTAPAY,
          'UP-999',
          'user-1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should return ALREADY_PAID without updating DB if transaction is already validated (Idempotency)', async () => {
      uddoktaPayGateway.verifyPayment.mockResolvedValue({
        isSuccess: true,
        gatewayTranId: 'TXN-100',
        gatewayValId: 'UP-999',
        amountBdt: 1500,
        rawPayload: {},
      });

      prisma.paymentTransaction.findUnique.mockResolvedValue({
        id: 'tx-1',
        invoiceId: 'inv-1',
        status: TransactionStatus.VALIDATED,
        invoice: { userId: 'user-1', orderId: 'ord-1', status: InvoiceStatus.PAID },
      });

      const result = await service.verifyAndCompletePayment(
        PaymentGateway.UDDOKTAPAY,
        'UP-999',
      );

      expect(result).toEqual({
        status: 'ALREADY_PAID',
        invoiceId: 'inv-1',
        orderId: 'ord-1',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should return PENDING without marking transaction FAILED when gateway reports pending', async () => {
      uddoktaPayGateway.verifyPayment.mockResolvedValue({
        isSuccess: false,
        isPending: true,
        gatewayTranId: 'TXN-100',
        gatewayValId: 'UP-999',
        amountBdt: 1500,
        rawPayload: { status: 'PENDING' },
      });

      prisma.paymentTransaction.findUnique.mockResolvedValue({
        id: 'tx-1',
        invoiceId: 'inv-1',
        status: TransactionStatus.PENDING,
        invoice: { userId: 'user-1', orderId: 'ord-1', status: InvoiceStatus.UNPAID },
      });

      const result = await service.verifyAndCompletePayment(
        PaymentGateway.UDDOKTAPAY,
        'UP-999',
      );

      expect(result).toEqual({ status: 'PENDING', invoiceId: 'inv-1' });
      expect(prisma.paymentTransaction.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if paid amount is less than expected amount', async () => {
      uddoktaPayGateway.verifyPayment.mockResolvedValue({
        isSuccess: true,
        gatewayTranId: 'TXN-100',
        gatewayValId: 'UP-999',
        amountBdt: 500,
        rawPayload: {},
      });

      prisma.paymentTransaction.findUnique.mockResolvedValue({
        id: 'tx-1',
        invoiceId: 'inv-1',
        gatewayTranId: 'TXN-100',
        amountBdt: 1500,
        status: TransactionStatus.PENDING,
        invoice: { userId: 'user-1', orderId: 'ord-1', status: InvoiceStatus.UNPAID },
      });

      await expect(
        service.verifyAndCompletePayment(PaymentGateway.UDDOKTAPAY, 'UP-999'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should complete transaction, mark invoice & order PAID, create AuditLog, and emit payment.completed', async () => {
      uddoktaPayGateway.verifyPayment.mockResolvedValue({
        isSuccess: true,
        gatewayTranId: 'TXN-100',
        gatewayValId: 'UP-999',
        amountBdt: 1500,
        rawPayload: { status: 'COMPLETED' },
      });

      prisma.paymentTransaction.findUnique.mockResolvedValue({
        id: 'tx-1',
        invoiceId: 'inv-1',
        gatewayTranId: 'TXN-100',
        amountBdt: 1500,
        status: TransactionStatus.PENDING,
        invoice: {
          userId: 'user-1',
          orderId: 'ord-1',
          status: InvoiceStatus.UNPAID,
        },
      });

      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.invoice.updateMany.mockResolvedValue({ count: 1 });
      prisma.order.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.verifyAndCompletePayment(
        PaymentGateway.UDDOKTAPAY,
        'UP-999',
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.invoice.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'inv-1',
            status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.OVERDUE] },
          },
          data: expect.objectContaining({ status: InvoiceStatus.PAID }),
        }),
      );
      expect(prisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ord-1', status: OrderStatus.PENDING_PAYMENT },
          data: { status: OrderStatus.PAID },
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        PAYMENT_COMPLETED_EVENT,
        expect.any(PaymentCompletedEvent),
      );
      expect(result).toEqual({
        status: 'COMPLETED',
        invoiceId: 'inv-1',
        orderId: 'ord-1',
      });
    });

    it('should return ALREADY_PAID if concurrent request already claimed the transaction', async () => {
      uddoktaPayGateway.verifyPayment.mockResolvedValue({
        isSuccess: true,
        gatewayTranId: 'TXN-100',
        gatewayValId: 'UP-999',
        amountBdt: 1500,
        rawPayload: { status: 'COMPLETED' },
      });

      prisma.paymentTransaction.findUnique.mockResolvedValue({
        id: 'tx-1',
        invoiceId: 'inv-1',
        gatewayTranId: 'TXN-100',
        amountBdt: 1500,
        status: TransactionStatus.PENDING,
        invoice: {
          userId: 'user-1',
          orderId: 'ord-1',
          status: InvoiceStatus.UNPAID,
        },
      });

      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.verifyAndCompletePayment(
        PaymentGateway.UDDOKTAPAY,
        'UP-999',
      );

      expect(result).toEqual({
        status: 'ALREADY_PAID',
        invoiceId: 'inv-1',
        orderId: 'ord-1',
      });
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('getTransactionStatus', () => {
    it('should return transaction status for owner', async () => {
      prisma.paymentTransaction.findUnique.mockResolvedValue({
        gatewayTranId: 'TXN-100',
        gateway: PaymentGateway.UDDOKTAPAY,
        status: TransactionStatus.VALIDATED,
        amountBdt: 1500,
        currency: 'BDT',
        createdAt: new Date('2026-11-26T00:00:00Z'),
        invoice: {
          id: 'inv-1',
          invoiceNumber: 'INV-1',
          userId: 'user-1',
          orderId: 'ord-1',
          status: InvoiceStatus.PAID,
          paidAt: new Date('2026-11-26T00:05:00Z'),
        },
      });

      const res = await service.getTransactionStatus('user-1', 'TXN-100');
      expect(res.status).toBe(TransactionStatus.VALIDATED);
      expect(res.invoiceStatus).toBe(InvoiceStatus.PAID);
    });

    it('should throw NotFoundException if transaction belongs to another user', async () => {
      prisma.paymentTransaction.findUnique.mockResolvedValue({
        gatewayTranId: 'TXN-100',
        invoice: { userId: 'other-user' },
      });

      await expect(
        service.getTransactionStatus('user-1', 'TXN-100'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
