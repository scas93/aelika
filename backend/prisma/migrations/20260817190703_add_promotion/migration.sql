-- CreateEnum
CREATE TYPE "PromotionTipo" AS ENUM ('DESCUENTO_PRODUCTO', 'COMBO');

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tipo" "PromotionTipo" NOT NULL,
    "config" JSONB NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotions_tenantId_idx" ON "promotions"("tenantId");

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
