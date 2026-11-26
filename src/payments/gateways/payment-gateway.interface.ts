import { PaymentGateway } from '@prisma/client';

export interface GatewayCreateInput {
  gatewayTranId: string;
  amountBdt: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  invoiceNumber: string;
  metadata?: Record<string, any>;
}

export interface GatewayCreateResult {
  paymentUrl: string;
  gatewayPaymentId?: string;
  rawResponse: any;
}

export interface GatewayVerifyResult {
  isSuccess: boolean;
  isPending?: boolean;
  gatewayTranId?: string;
  gatewayValId: string; // UddoktaPay invoice_id বা bKash trxID
  amountBdt: number;
  rawPayload: any;
}

export interface IPaymentGateway {
  readonly provider: PaymentGateway;
  createPayment(input: GatewayCreateInput): Promise<GatewayCreateResult>;
  verifyPayment(referenceId: string): Promise<GatewayVerifyResult>;
}
