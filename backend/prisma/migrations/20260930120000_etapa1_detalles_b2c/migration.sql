-- Etapa 1 del refactor de órdenes centralizadas: lo exclusivo de un pedido B2C
-- pasa a una tabla de detalle 1:1 (detalles_b2c) y Order gana `tipo`.
-- Hand-written (datos dentro de la migración), mismo precedente que
-- 20260908233348_modulo2_order_pedidob2b_cliente_id.
--
-- Diseño de compatibilidad (traslape de despliegue y reversa):
--   * orders.tipo es NOT NULL con DEFAULT 'B2C': el contenedor anterior, que no
--     escribe `tipo`, sigue creando órdenes sin fallar. El default se retira en
--     la Etapa 1b junto con las columnas viejas.
--   * Las columnas viejas de orders NO se tocan ni se borran. El código nuevo las
--     sigue escribiendo (escritura doble) y las usa como respaldo de lectura
--     cuando una orden no tiene detalle (la creó el contenedor anterior).
--   * El backfill es idempotente (WHERE NOT EXISTS + UNIQUE en orderId).
--
-- Si `prisma migrate deploy` falla aquí, el servicio no levanta (start:prod).

-- gen_random_uuid() — pgcrypto ya está aplicada en todos los entornos por la
-- migración del Módulo 2; se declara igual, es idempotente.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateEnum
CREATE TYPE "TipoOrden" AS ENUM ('B2C', 'B2B');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "tipo" "TipoOrden" NOT NULL DEFAULT 'B2C';

-- CreateTable
CREATE TABLE "detalles_b2c" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "horaRecogidaTipo" "HoraRecogidaTipo" NOT NULL DEFAULT 'LO_ANTES_POSIBLE',
    "horaRecogida" TEXT,
    "metodoEntrega" "MetodoEntrega" NOT NULL DEFAULT 'RECOGER',
    "puntoEnvioId" TEXT,
    "direccionCalle" TEXT,
    "direccionNumero" TEXT,
    "direccionColonia" TEXT,
    "direccionReferencias" TEXT,
    "notasDescuento" TEXT,

    CONSTRAINT "detalles_b2c_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "detalles_b2c_orderId_key" ON "detalles_b2c"("orderId");

-- CreateIndex
CREATE INDEX "detalles_b2c_tenantId_idx" ON "detalles_b2c"("tenantId");

-- CreateIndex
CREATE INDEX "detalles_b2c_puntoEnvioId_idx" ON "detalles_b2c"("puntoEnvioId");

-- AddForeignKey
ALTER TABLE "detalles_b2c" ADD CONSTRAINT "detalles_b2c_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalles_b2c" ADD CONSTRAINT "detalles_b2c_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (Restrict: borrar un PuntoEnvio con pedidos sigue dando P2003 -> 409)
ALTER TABLE "detalles_b2c" ADD CONSTRAINT "detalles_b2c_puntoEnvioId_fkey" FOREIGN KEY ("puntoEnvioId") REFERENCES "puntos_envio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: un detalle por cada Order existente, con los valores actuales de sus
-- columnas. tipo ya quedó en 'B2C' para todas por el DEFAULT del ADD COLUMN.
INSERT INTO "detalles_b2c" (
  "id", "tenantId", "orderId", "horaRecogidaTipo", "horaRecogida", "metodoEntrega",
  "puntoEnvioId", "direccionCalle", "direccionNumero", "direccionColonia",
  "direccionReferencias", "notasDescuento"
)
SELECT
  gen_random_uuid()::text, o."tenantId", o."id", o."horaRecogidaTipo", o."horaRecogida", o."metodoEntrega",
  o."puntoEnvioId", o."direccionCalle", o."direccionNumero", o."direccionColonia",
  o."direccionReferencias", o."notasDescuento"
FROM "orders" o
WHERE NOT EXISTS (SELECT 1 FROM "detalles_b2c" d WHERE d."orderId" = o."id");
