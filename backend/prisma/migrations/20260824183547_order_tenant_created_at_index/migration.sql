-- DropIndex
DROP INDEX "orders_tenantId_idx";

-- CreateIndex
CREATE INDEX "orders_tenantId_createdAt_idx" ON "orders"("tenantId", "createdAt");
