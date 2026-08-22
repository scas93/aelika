
-- CreateEnum
CREATE TYPE "EstadoPago" AS ENUM ('PENDIENTE', 'PAGADO', 'FALLIDO');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "estadoPago" "EstadoPago" NOT NULL DEFAULT 'PAGADO',
ADD COLUMN     "stripePaymentIntentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_stripePaymentIntentId_key" ON "orders"("stripePaymentIntentId");

