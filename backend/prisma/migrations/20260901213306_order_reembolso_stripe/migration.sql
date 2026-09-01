-- AlterEnum
ALTER TYPE "EstadoPago" ADD VALUE 'REEMBOLSADO';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "stripeRefundId" TEXT;
