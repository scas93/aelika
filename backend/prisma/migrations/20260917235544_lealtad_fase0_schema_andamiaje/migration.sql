-- CreateEnum
CREATE TYPE "LoyaltyCardEstado" AS ENUM ('EN_PROGRESO', 'PREMIO_DISPONIBLE');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "pinLealtad" TEXT;

-- CreateTable
CREATE TABLE "loyalty_cards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "contador" INTEGER NOT NULL DEFAULT 0,
    "estado" "LoyaltyCardEstado" NOT NULL DEFAULT 'EN_PROGRESO',
    "serialNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_visits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loyaltyCardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_redemptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loyaltyCardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_cards_clienteId_key" ON "loyalty_cards"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_cards_token_key" ON "loyalty_cards"("token");

-- CreateIndex
CREATE INDEX "loyalty_cards_tenantId_idx" ON "loyalty_cards"("tenantId");

-- CreateIndex
CREATE INDEX "loyalty_visits_tenantId_idx" ON "loyalty_visits"("tenantId");

-- CreateIndex
CREATE INDEX "loyalty_redemptions_tenantId_idx" ON "loyalty_redemptions"("tenantId");

-- AddForeignKey
ALTER TABLE "loyalty_cards" ADD CONSTRAINT "loyalty_cards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_cards" ADD CONSTRAINT "loyalty_cards_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_visits" ADD CONSTRAINT "loyalty_visits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_visits" ADD CONSTRAINT "loyalty_visits_loyaltyCardId_fkey" FOREIGN KEY ("loyaltyCardId") REFERENCES "loyalty_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_redemptions" ADD CONSTRAINT "loyalty_redemptions_loyaltyCardId_fkey" FOREIGN KEY ("loyaltyCardId") REFERENCES "loyalty_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
