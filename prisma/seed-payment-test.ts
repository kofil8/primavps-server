import 'dotenv/config';
import {
  PrismaClient,
  InvoiceStatus,
  OrderStatus,
  ProductType,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'sandbox.tester@primavps.com' },
    update: {},
    create: {
      email: 'sandbox.tester@primavps.com',
      password: 'kdak@#$343Ks',
      firstName: 'Tanvir',
      lastName: 'Hasan',
      phone: '01700000000',
      emailVerified: true,
    },
  });

  const order = await prisma.order.create({
    data: {
      orderNumber: `PVPS-TEST-${Date.now()}`,
      userId: user.id,
      productType: ProductType.CLOUD_VPS,
      country: 'US',
      osName: 'Ubuntu 24.04',
      regionName: 'Ashburn, VA',
      subtotalBdt: 500,
      totalBdt: 500,
      status: OrderStatus.PENDING_PAYMENT,
    },
  });

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: `INV-TEST-${Date.now()}`,
      userId: user.id,
      orderId: order.id,
      description: 'Cloud VPS - Ashburn, VA (Monthly Sandbox Test)',
      amountBdt: 500,
      status: InvoiceStatus.UNPAID,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  console.log('\n=========================================');
  console.log('✅ Sandbox Test Data Created Successfully');
  console.log('=========================================');
  console.log('User ID    :', user.id);
  console.log('Order ID   :', order.id);
  console.log('Invoice ID :', invoice.id);
  console.log('=========================================\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
