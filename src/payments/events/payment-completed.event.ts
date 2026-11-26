import { PaymentGateway } from '@prisma/client';

export const PAYMENT_COMPLETED_EVENT = 'payment.completed';

export class PaymentCompletedEvent {
  constructor(
    public readonly invoiceId: string,
    public readonly orderId: string | null,
    public readonly userId: string,
    public readonly gateway: PaymentGateway,
    public readonly gatewayTranId: string,
    public readonly gatewayValId: string,
    public readonly amountBdt: number,
  ) {}
}
