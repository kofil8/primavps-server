-- CreateEnum
CREATE TYPE "WalletTxnType" AS ENUM ('CREDIT', 'DEBIT', 'REFUND');

-- DropIndex
DROP INDEX "posts_published_createdAt_idx";

-- DropIndex
DROP INDEX "users_role_idx";

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "agencyName" TEXT,
ADD COLUMN     "customDomain" TEXT,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "supportEmail" TEXT;

-- AlterTable
ALTER TABLE "vps_instances" ADD COLUMN     "resellerClientId" TEXT;

-- CreateTable
CREATE TABLE "cloud_pricing_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "perVcpuBdt" INTEGER NOT NULL DEFAULT 400,
    "perGbRamBdt" INTEGER NOT NULL DEFAULT 180,
    "per10GbNvmeBdt" INTEGER NOT NULL DEFAULT 40,
    "residentialIpAddonBdt" INTEGER NOT NULL DEFAULT 1200,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cloud_pricing_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloud_regions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cloud_regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloud_os_images" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subtitle" TEXT,
    "minRamGb" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cloud_os_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "WalletTxnType" NOT NULL,
    "amountBdt" INTEGER NOT NULL,
    "balanceAfterBdt" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'MANUAL',
    "description" TEXT NOT NULL,
    "referenceId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reseller_clients" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "company" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reseller_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reseller_api_keys" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reseller_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cloud_regions_code_key" ON "cloud_regions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "cloud_os_images_slug_key" ON "cloud_os_images"("slug");

-- CreateIndex
CREATE INDEX "wallet_transactions_userId_createdAt_idx" ON "wallet_transactions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "reseller_clients_resellerId_idx" ON "reseller_clients"("resellerId");

-- CreateIndex
CREATE UNIQUE INDEX "reseller_api_keys_keyHash_key" ON "reseller_api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "reseller_api_keys_resellerId_isActive_idx" ON "reseller_api_keys"("resellerId", "isActive");

-- CreateIndex
CREATE INDEX "posts_published_featured_createdAt_idx" ON "posts"("published", "featured", "createdAt");

-- CreateIndex
CREATE INDEX "users_role_isSuspended_idx" ON "users"("role", "isSuspended");

-- CreateIndex
CREATE INDEX "vps_instances_resellerClientId_idx" ON "vps_instances"("resellerClientId");

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_clients" ADD CONSTRAINT "reseller_clients_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reseller_api_keys" ADD CONSTRAINT "reseller_api_keys_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vps_instances" ADD CONSTRAINT "vps_instances_resellerClientId_fkey" FOREIGN KEY ("resellerClientId") REFERENCES "reseller_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
