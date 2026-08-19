-- Adds configurable facturación + simple delivery zones (PuntoEnvio) +
-- splits delivery method from payment method. MetodoPago's values are
-- replaced entirely (AL_RECOGER/PAGO_EN_LINEA -> EFECTIVO/TRANSFERENCIA/
-- TARJETA), so this is hand-written (not `prisma migrate dev`) to convert
-- existing rows instead of losing them: every existing order was paid in
-- person at pickup, so both old values collapse to EFECTIVO.

-- CreateEnum
CREATE TYPE "FacturacionModo" AS ENUM ('OBLIGATORIO', 'OPCIONAL', 'DESACTIVADO');

-- CreateEnum
CREATE TYPE "MetodoEntrega" AS ENUM ('RECOGER', 'DOMICILIO');

-- AlterTable: Tenant.facturacionModo
ALTER TABLE "tenants" ADD COLUMN "facturacionModo" "FacturacionModo" NOT NULL DEFAULT 'DESACTIVADO';

-- CreateTable: PuntoEnvio
CREATE TABLE "puntos_envio" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "pedidoMinimo" DECIMAL(10,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "puntos_envio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "puntos_envio_tenantId_idx" ON "puntos_envio"("tenantId");

-- AddForeignKey
ALTER TABLE "puntos_envio" ADD CONSTRAINT "puntos_envio_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- MetodoPago: replace enum values entirely. Build the new type alongside the
-- old one, convert the column's data with an explicit mapping, then swap.
CREATE TYPE "MetodoPago_new" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA');

ALTER TABLE "orders" ALTER COLUMN "metodoPago" DROP DEFAULT;
ALTER TABLE "orders" ALTER COLUMN "metodoPago" TYPE "MetodoPago_new" USING (
  CASE "metodoPago"::text
    WHEN 'AL_RECOGER' THEN 'EFECTIVO'
    WHEN 'PAGO_EN_LINEA' THEN 'EFECTIVO'
  END
)::"MetodoPago_new";
ALTER TABLE "orders" ALTER COLUMN "metodoPago" SET DEFAULT 'EFECTIVO';

DROP TYPE "MetodoPago";
ALTER TYPE "MetodoPago_new" RENAME TO "MetodoPago";

-- AlterTable: Order — metodoEntrega, puntoEnvioId, factura* fields
ALTER TABLE "orders" ADD COLUMN "metodoEntrega" "MetodoEntrega" NOT NULL DEFAULT 'RECOGER';
ALTER TABLE "orders" ADD COLUMN "puntoEnvioId" TEXT;
ALTER TABLE "orders" ADD COLUMN "requiereFactura" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "orders" ADD COLUMN "facturaRazonSocial" TEXT;
ALTER TABLE "orders" ADD COLUMN "facturaRfc" TEXT;
ALTER TABLE "orders" ADD COLUMN "facturaRegimenFiscal" TEXT;
ALTER TABLE "orders" ADD COLUMN "facturaUsoCfdi" TEXT;
ALTER TABLE "orders" ADD COLUMN "facturaCodigoPostal" TEXT;
ALTER TABLE "orders" ADD COLUMN "facturaCorreo" TEXT;

-- CreateIndex
CREATE INDEX "orders_puntoEnvioId_idx" ON "orders"("puntoEnvioId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_puntoEnvioId_fkey" FOREIGN KEY ("puntoEnvioId") REFERENCES "puntos_envio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
