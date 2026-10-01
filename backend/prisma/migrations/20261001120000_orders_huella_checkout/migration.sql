-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "huellaCheckout" TEXT;

-- CreateIndex
CREATE INDEX "orders_tenantId_huellaCheckout_idx" ON "orders"("tenantId", "huellaCheckout");
