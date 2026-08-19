-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "descuentoTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "notasDescuento" TEXT,
ALTER COLUMN "metodoPago" SET DEFAULT 'al_recoger';
