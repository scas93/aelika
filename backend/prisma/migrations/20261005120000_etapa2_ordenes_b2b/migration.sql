-- Etapa 2 · órdenes B2B en la orden centralizada (Release A: SOLO esquema, aditivo).
-- Compatible con el contenedor anterior: las columnas/tablas nuevas tienen default o son opcionales.
-- La migración de DATOS (PedidoB2b -> Order) es un script aparte: backend/scripts/etapa2/.
-- CreateEnum
CREATE TYPE "EstadoEntrega" AS ENUM ('PENDIENTE', 'LISTA', 'ENTREGADA', 'CANCELADA');

-- DropIndex
DROP INDEX "orders_tenantId_folio_key";

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "orden" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancelado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canceladoAt" TIMESTAMP(3),
ALTER COLUMN "metodoPago" DROP NOT NULL;

-- CreateTable
CREATE TABLE "detalles_b2b" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "legacyPedidoB2bId" TEXT,
    "negocioNombre" TEXT NOT NULL,
    "semanaInicio" DATE NOT NULL,
    "modoCobro" "PedidoB2bModoCobro" NOT NULL,
    "minimoPiezasAplicado" INTEGER NOT NULL,
    "totalPiezas" INTEGER NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "codigoDescuentoId" TEXT,
    "codigoDescuentoTexto" TEXT,
    "descuentoPorcentajeAplicado" DECIMAL(5,2),

    CONSTRAINT "detalles_b2b_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entregas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "estado" "EstadoEntrega" NOT NULL DEFAULT 'PENDIENTE',
    "nota" TEXT,
    "hora" TEXT,
    "destino" TEXT,
    "estadoCambiadoAt" TIMESTAMP(3),
    "estadoCambiadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entregas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entrega_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entregaId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "entrega_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "detalles_b2b_orderId_key" ON "detalles_b2b"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "detalles_b2b_legacyPedidoB2bId_key" ON "detalles_b2b"("legacyPedidoB2bId");

-- CreateIndex
CREATE INDEX "detalles_b2b_tenantId_semanaInicio_idx" ON "detalles_b2b"("tenantId", "semanaInicio");

-- CreateIndex
CREATE INDEX "detalles_b2b_codigoDescuentoId_idx" ON "detalles_b2b"("codigoDescuentoId");

-- CreateIndex
CREATE INDEX "entregas_orderId_fecha_idx" ON "entregas"("orderId", "fecha");

-- CreateIndex
CREATE INDEX "entregas_tenantId_fecha_idx" ON "entregas"("tenantId", "fecha");

-- CreateIndex
CREATE INDEX "entrega_items_tenantId_idx" ON "entrega_items"("tenantId");

-- CreateIndex
CREATE INDEX "entrega_items_orderItemId_idx" ON "entrega_items"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "entrega_items_entregaId_orderItemId_key" ON "entrega_items"("entregaId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenantId_tipo_folio_key" ON "orders"("tenantId", "tipo", "folio");

-- AddForeignKey
ALTER TABLE "detalles_b2b" ADD CONSTRAINT "detalles_b2b_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalles_b2b" ADD CONSTRAINT "detalles_b2b_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalles_b2b" ADD CONSTRAINT "detalles_b2b_codigoDescuentoId_fkey" FOREIGN KEY ("codigoDescuentoId") REFERENCES "pedido_b2b_codigos_descuento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entregas" ADD CONSTRAINT "entregas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entregas" ADD CONSTRAINT "entregas_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entregas" ADD CONSTRAINT "entregas_estadoCambiadoPorId_fkey" FOREIGN KEY ("estadoCambiadoPorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrega_items" ADD CONSTRAINT "entrega_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrega_items" ADD CONSTRAINT "entrega_items_entregaId_fkey" FOREIGN KEY ("entregaId") REFERENCES "entregas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entrega_items" ADD CONSTRAINT "entrega_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Etapa 2: las órdenes B2C nunca pueden quedar sin método de pago (metodoPago pasó a nullable solo para B2B).
-- Prisma no modela CHECK; vive aquí y en la base.
ALTER TABLE "orders" ADD CONSTRAINT "orders_metodoPago_b2c_check" CHECK ("tipo" <> 'B2C' OR "metodoPago" IS NOT NULL);
