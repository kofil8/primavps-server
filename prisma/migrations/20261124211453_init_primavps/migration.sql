-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'RESELLER', 'USER');

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('ISP_VPS', 'CLOUD_VPS', 'RESELLER_PACK');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'PROVISIONING', 'ACTIVE', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('SSLCOMMERZ', 'BKASH', 'NAGAD', 'ROCKET', 'WALLET', 'MANUAL');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('INITIATED', 'PENDING', 'VALIDATED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "IpStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'ASSIGNED', 'FLAGGED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "InstanceStatus" AS ENUM ('PROVISIONING', 'RUNNING', 'STOPPED', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('PENDING', 'APPROVED', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "NodeHealth" AS ENUM ('OPERATIONAL', 'DEGRADED', 'MAINTENANCE', 'OUTAGE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "walletBalanceBdt" INTEGER NOT NULL DEFAULT 0,
    "resellerDiscount" INTEGER NOT NULL DEFAULT 0,
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerificationToken" TEXT,
    "emailVerificationTokenExpiry" TIMESTAMP(3),
    "resetToken" TEXT,
    "resetTokenExpiry" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT,
    "category" TEXT,
    "summary" TEXT,
    "content" TEXT NOT NULL,
    "readTime" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "url" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'local',
    "visibility" "FileVisibility" NOT NULL DEFAULT 'PRIVATE',
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "productType" "ProductType" NOT NULL,
    "vcpu" INTEGER NOT NULL,
    "ramGb" INTEGER NOT NULL,
    "nvmeGb" INTEGER NOT NULL,
    "bandwidth" TEXT NOT NULL DEFAULT '1 Gbps Unmetered',
    "osDefault" TEXT NOT NULL DEFAULT 'Windows 11 Pro',
    "priceBdt" INTEGER NOT NULL,
    "priceFreshBdt" INTEGER,
    "stockCount" INTEGER NOT NULL DEFAULT 10,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountPercent" INTEGER NOT NULL,
    "applicableTypes" "ProductType"[],
    "firstMonthOnly" BOOLEAN NOT NULL DEFAULT true,
    "minOrderBdt" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER,
    "maxUsesPerUser" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT,
    "productType" "ProductType" NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "carrier" TEXT DEFAULT 'Auto',
    "isFreshIp" BOOLEAN NOT NULL DEFAULT false,
    "osName" TEXT,
    "regionName" TEXT,
    "customSpecs" JSONB,
    "cycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "subtotalBdt" INTEGER NOT NULL,
    "cycleDiscountBdt" INTEGER NOT NULL DEFAULT 0,
    "couponDiscountBdt" INTEGER NOT NULL DEFAULT 0,
    "totalBdt" INTEGER NOT NULL,
    "couponId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "instanceId" TEXT,
    "description" TEXT NOT NULL,
    "amountBdt" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "gatewayTranId" TEXT NOT NULL,
    "gatewayValId" TEXT,
    "amountBdt" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "status" "TransactionStatus" NOT NULL DEFAULT 'INITIATED',
    "refundedAmountBdt" INTEGER NOT NULL DEFAULT 0,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proxmox_nodes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "health" "NodeHealth" NOT NULL DEFAULT 'OPERATIONAL',
    "pingMs" INTEGER,
    "uptimePct" DOUBLE PRECISION NOT NULL DEFAULT 99.98,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proxmox_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ip_pool" (
    "id" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "subnet" TEXT,
    "country" TEXT NOT NULL,
    "state" TEXT,
    "carrier" TEXT NOT NULL,
    "asn" TEXT,
    "isVirgin" BOOLEAN NOT NULL DEFAULT false,
    "lastIpqsScore" INTEGER,
    "lastCheckedAt" TIMESTAMP(3),
    "status" "IpStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ip_pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vps_instances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "nodeId" TEXT,
    "proxmoxVmId" INTEGER,
    "ipPoolId" TEXT,
    "hostname" TEXT,
    "ipAddress" TEXT,
    "rdpPort" INTEGER NOT NULL DEFAULT 3389,
    "username" TEXT DEFAULT 'Administrator',
    "passwordEnc" TEXT,
    "osName" TEXT NOT NULL DEFAULT 'Windows 11 Pro',
    "vcpu" INTEGER NOT NULL,
    "ramGb" INTEGER NOT NULL,
    "nvmeGb" INTEGER NOT NULL,
    "country" TEXT NOT NULL,
    "carrier" TEXT,
    "status" "InstanceStatus" NOT NULL DEFAULT 'PROVISIONING',
    "provisionedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "freeSwapEligibleUntil" TIMESTAMP(3),
    "freeSwapsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vps_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ip_swap_requests" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "oldIp" TEXT NOT NULL,
    "newIp" TEXT,
    "reason" TEXT NOT NULL,
    "ipqsScoreAtRequest" INTEGER,
    "isFree" BOOLEAN NOT NULL DEFAULT true,
    "feeBdt" INTEGER NOT NULL DEFAULT 0,
    "status" "SwapStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "handledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ip_swap_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instanceId" TEXT,
    "subject" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT 'TECHNICAL',
    "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "posts_slug_key" ON "posts"("slug");

-- CreateIndex
CREATE INDEX "posts_published_createdAt_idx" ON "posts"("published", "createdAt");

-- CreateIndex
CREATE INDEX "email_logs_to_idx" ON "email_logs"("to");

-- CreateIndex
CREATE UNIQUE INDEX "plans_slug_key" ON "plans"("slug");

-- CreateIndex
CREATE INDEX "plans_productType_isActive_idx" ON "plans"("productType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_code_isActive_idx" ON "coupons"("code", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_orderId_key" ON "coupon_redemptions"("orderId");

-- CreateIndex
CREATE INDEX "coupon_redemptions_couponId_userId_idx" ON "coupon_redemptions"("couponId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");

-- CreateIndex
CREATE INDEX "orders_userId_status_idx" ON "orders"("userId", "status");

-- CreateIndex
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "invoices_userId_status_idx" ON "invoices"("userId", "status");

-- CreateIndex
CREATE INDEX "invoices_dueDate_status_idx" ON "invoices"("dueDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_gatewayTranId_key" ON "payment_transactions"("gatewayTranId");

-- CreateIndex
CREATE INDEX "payment_transactions_invoiceId_idx" ON "payment_transactions"("invoiceId");

-- CreateIndex
CREATE INDEX "payment_transactions_status_idx" ON "payment_transactions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "proxmox_nodes_name_key" ON "proxmox_nodes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ip_pool_ipAddress_key" ON "ip_pool"("ipAddress");

-- CreateIndex
CREATE INDEX "ip_pool_country_carrier_isVirgin_status_idx" ON "ip_pool"("country", "carrier", "isVirgin", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vps_instances_orderId_key" ON "vps_instances"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "vps_instances_ipPoolId_key" ON "vps_instances"("ipPoolId");

-- CreateIndex
CREATE INDEX "vps_instances_userId_status_idx" ON "vps_instances"("userId", "status");

-- CreateIndex
CREATE INDEX "vps_instances_expiresAt_status_idx" ON "vps_instances"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "ip_swap_requests_status_createdAt_idx" ON "ip_swap_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ip_swap_requests_instanceId_idx" ON "ip_swap_requests"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_ticketNumber_key" ON "support_tickets"("ticketNumber");

-- CreateIndex
CREATE INDEX "support_tickets_userId_status_idx" ON "support_tickets"("userId", "status");

-- CreateIndex
CREATE INDEX "ticket_messages_ticketId_createdAt_idx" ON "ticket_messages"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "vps_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vps_instances" ADD CONSTRAINT "vps_instances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vps_instances" ADD CONSTRAINT "vps_instances_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vps_instances" ADD CONSTRAINT "vps_instances_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "proxmox_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vps_instances" ADD CONSTRAINT "vps_instances_ipPoolId_fkey" FOREIGN KEY ("ipPoolId") REFERENCES "ip_pool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ip_swap_requests" ADD CONSTRAINT "ip_swap_requests_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "vps_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ip_swap_requests" ADD CONSTRAINT "ip_swap_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ip_swap_requests" ADD CONSTRAINT "ip_swap_requests_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "vps_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
