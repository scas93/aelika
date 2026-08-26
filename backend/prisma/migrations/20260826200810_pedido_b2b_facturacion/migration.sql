-- AlterTable
ALTER TABLE "pedidos_b2b" ADD COLUMN     "facturaCodigoPostal" TEXT,
ADD COLUMN     "facturaCorreo" TEXT,
ADD COLUMN     "facturaRazonSocial" TEXT,
ADD COLUMN     "facturaRegimenFiscal" TEXT,
ADD COLUMN     "facturaRfc" TEXT,
ADD COLUMN     "facturaUsoCfdi" TEXT,
ADD COLUMN     "requiereFactura" BOOLEAN NOT NULL DEFAULT false;
