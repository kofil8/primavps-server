import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { PaymentGateway } from '@prisma/client';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { UddoktaPayGateway } from './gateways/uddoktapay.gateway';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let paymentsService: jest.Mocked<PaymentsService>;
  let uddoktaPayGateway: jest.Mocked<UddoktaPayGateway>;

  beforeEach(async () => {
    const mockPaymentsService = {
      initiatePayment: jest.fn(),
      verifyAndCompletePayment: jest.fn(),
    };

    const mockUddoktaPayGateway = {
      verifyWebhookSignature: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: UddoktaPayGateway, useValue: mockUddoktaPayGateway },
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
    paymentsService = module.get(PaymentsService);
    uddoktaPayGateway = module.get(UddoktaPayGateway);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('initiate', () => {
    it('should initiate payment with default UDDOKTAPAY gateway', async () => {
      const mockReq = { user: { id: 'user-uuid-1' } };
      const dto = { invoiceId: 'inv-uuid-1' };
      const expectedResult = {
        paymentUrl: 'https://uddoktapay.com',
        gatewayTranId: 'TXN-123456',
      };

      paymentsService.initiatePayment.mockResolvedValue(expectedResult);

      const result = await controller.initiate(mockReq, dto);

      expect(paymentsService.initiatePayment).toHaveBeenCalledWith(
        'user-uuid-1',
        'inv-uuid-1',
        PaymentGateway.UDDOKTAPAY,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('verifyUddoktaPay', () => {
    it('should verify payment using UddoktaPay invoice_id', async () => {
      const dto = { invoice_id: 'UP-INV-999' };
      const expectedResult = {
        status: 'COMPLETED',
        invoiceId: 'inv-uuid-1',
        orderId: 'ord-uuid-1',
      };

      paymentsService.verifyAndCompletePayment.mockResolvedValue(expectedResult);

      const result = await controller.verifyUddoktaPay(dto);

      expect(paymentsService.verifyAndCompletePayment).toHaveBeenCalledWith(
        PaymentGateway.UDDOKTAPAY,
        'UP-INV-999',
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('uddoktaPayWebhook', () => {
    it('should throw UnauthorizedException when webhook API key is invalid', async () => {
      uddoktaPayGateway.verifyWebhookSignature.mockReturnValue(false);

      await expect(
        controller.uddoktaPayWebhook('invalid-key', { invoice_id: 'UP-INV-999' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(paymentsService.verifyAndCompletePayment).not.toHaveBeenCalled();
    });

    it('should process payment and return received: true for valid webhook', async () => {
      uddoktaPayGateway.verifyWebhookSignature.mockReturnValue(true);
      paymentsService.verifyAndCompletePayment.mockResolvedValue({
        status: 'COMPLETED',
        invoiceId: 'inv-uuid-1',
        orderId: 'ord-uuid-1',
      });

      const result = await controller.uddoktaPayWebhook('valid-api-key', {
        invoice_id: 'UP-INV-999',
      });

      expect(paymentsService.verifyAndCompletePayment).toHaveBeenCalledWith(
        PaymentGateway.UDDOKTAPAY,
        'UP-INV-999',
      );
      expect(result).toEqual({ received: true });
    });
  });
});
