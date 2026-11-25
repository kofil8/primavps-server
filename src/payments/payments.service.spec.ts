import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  PaymentGateway,
  InvoiceStatus,
  OrderStatus,
  TransactionStatus,
} from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../core/prisma/prisma.service';
import { UddoktaPayGateway } from './gateways/uddoktapay.gateway';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: any;
  let uddoktaPayGateway: jest.Mocked<UddoktaPayGateway>;

  beforeEach(async () => {
    prisma = {
      invoice: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      order: {
        update: jest.fn(),
      },
      paymentTransaction: {
        create: jest.fn(),
        update: jest.fn(),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: UddoktaPayGateway, useValue: mockUddoktaPayGateway },
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

    it('should create transaction and return checkout URL', async () => {
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
          data: expect.objectContaining({ status: TransactionStatus.PENDING }),
        }),
      );
      expect(result.paymentUrl).toBe('https://uddoktapay.com');
      expect(result.gatewayTranId).toMatch(/^TXN-/);
    });
  });

  describe('verifyAndCompletePayment', () => {
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
      });

      const result = await service.verifyAndCompletePayment(
        PaymentGateway.UDDOKTAPAY,
        'UP-999',
      );

      expect(result).toEqual({ status: 'ALREADY_PAID', invoiceId: 'inv-1' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if paid amount is less than expected amount', async () => {
      uddoktaPayGateway.verifyPayment.mockResolvedValue({
        isSuccess: true,
        gatewayTranId: 'TXN-100',
        gatewayValId: 'UP-999',
        amountBdt: 500, // কম টাকা পেমেন্ট করা হয়েছে
        rawPayload: {},
      });

      prisma.paymentTransaction.findUnique.mockResolvedValue({
        id: 'tx-1',
        invoiceId: 'inv-1',
        gatewayTranId: 'TXN-100',
        amountBdt: 1500,
        status: TransactionStatus.PENDING,
      });

      await expect(
        service.verifyAndCompletePayment(PaymentGateway.UDDOKTAPAY, 'UP-999'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should complete transaction, mark invoice & order PAID, and create AuditLog', async () => {
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
        invoice: { orderId: 'ord-1' },
      });

      prisma.invoice.update.mockResolvedValue({
        id: 'inv-1',
        orderId: 'ord-1',
        userId: 'user-1',
      });

      const result = await service.verifyAndCompletePayment(
        PaymentGateway.UDDOKTAPAY,
        'UP-999',
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
          data: expect.objectContaining({ status: InvoiceStatus.PAID }),
        }),
      );
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ord-1' },
          data: { status: OrderStatus.PAID },
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalled();
      expect(result).toEqual({
        status: 'COMPLETED',
        invoiceId: 'inv-1',
        orderId: 'ord-1',
      });
    });
  });
});
