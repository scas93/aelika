-- CreateEnum
CREATE TYPE "PedidoB2bModoCobro" AS ENUM ('AL_INICIO', 'AL_FINAL');

-- CreateEnum
CREATE TYPE "PedidoB2bEstado" AS ENUM ('PENDIENTE_CONFIRMACION', 'CONFIRMADO_SURTIENDO', 'DESPACHADO');

-- CreateEnum
CREATE TYPE "PedidoB2bEstadoPago" AS ENUM ('PENDIENTE', 'PAGADO');

-- CreateEnum
CREATE TYPE "DiaSemana" AS ENUM ('LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "pedidoB2bMinimoPiezas" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "pedidoB2bModoCobro" "PedidoB2bModoCobro" NOT NULL DEFAULT 'AL_FINAL';

-- CreateTable
CREATE TABLE "pedidos_b2b" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "negocioNombre" TEXT NOT NULL,
    "contactoNombre" TEXT NOT NULL,
    "contactoTelefono" TEXT NOT NULL,
    "contactoCorreo" TEXT NOT NULL,
    "semanaInicio" DATE NOT NULL,
    "modoCobro" "PedidoB2bModoCobro" NOT NULL,
    "estado" "PedidoB2bEstado" NOT NULL DEFAULT 'PENDIENTE_CONFIRMACION',
    "estadoPago" "PedidoB2bEstadoPago" NOT NULL DEFAULT 'PENDIENTE',
    "cancelado" BOOLEAN NOT NULL DEFAULT false,
    "canceladoAt" TIMESTAMP(3),
    "minimoPiezasAplicado" INTEGER NOT NULL,
    "totalPiezas" INTEGER NOT NULL DEFAULT 0,
    "codigoDescuentoId" TEXT,
    "codigoDescuentoTexto" TEXT,
    "descuentoPorcentajeAplicado" DECIMAL(5,2),
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "descuentoTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pedidos_b2b_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_b2b_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pedidoB2bId" TEXT NOT NULL,
    "productId" TEXT,
    "nombreProducto" TEXT NOT NULL,
    "precioUnitario" DECIMAL(10,2) NOT NULL,
    "cantidadTotal" INTEGER NOT NULL,

    CONSTRAINT "pedido_b2b_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_b2b_items_dia" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pedidoB2bItemId" TEXT NOT NULL,
    "dia" "DiaSemana" NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "pedido_b2b_items_dia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_b2b_codigos_descuento" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "descuentoPorcentaje" DECIMAL(5,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pedido_b2b_codigos_descuento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pedidos_b2b_tenantId_semanaInicio_idx" ON "pedidos_b2b"("tenantId", "semanaInicio");

-- CreateIndex
CREATE INDEX "pedidos_b2b_codigoDescuentoId_idx" ON "pedidos_b2b"("codigoDescuentoId");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_b2b_tenantId_folio_key" ON "pedidos_b2b"("tenantId", "folio");

-- CreateIndex
CREATE INDEX "pedido_b2b_items_tenantId_idx" ON "pedido_b2b_items"("tenantId");

-- CreateIndex
CREATE INDEX "pedido_b2b_items_pedidoB2bId_idx" ON "pedido_b2b_items"("pedidoB2bId");

-- CreateIndex
CREATE INDEX "pedido_b2b_items_dia_tenantId_idx" ON "pedido_b2b_items_dia"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_b2b_items_dia_pedidoB2bItemId_dia_key" ON "pedido_b2b_items_dia"("pedidoB2bItemId", "dia");

-- CreateIndex
CREATE INDEX "pedido_b2b_codigos_descuento_tenantId_idx" ON "pedido_b2b_codigos_descuento"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_b2b_codigos_descuento_tenantId_codigo_key" ON "pedido_b2b_codigos_descuento"("tenantId", "codigo");

-- AddForeignKey
ALTER TABLE "pedidos_b2b" ADD CONSTRAINT "pedidos_b2b_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_b2b" ADD CONSTRAINT "pedidos_b2b_codigoDescuentoId_fkey" FOREIGN KEY ("codigoDescuentoId") REFERENCES "pedido_b2b_codigos_descuento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_b2b_items" ADD CONSTRAINT "pedido_b2b_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_b2b_items" ADD CONSTRAINT "pedido_b2b_items_pedidoB2bId_fkey" FOREIGN KEY ("pedidoB2bId") REFERENCES "pedidos_b2b"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_b2b_items" ADD CONSTRAINT "pedido_b2b_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_b2b_items_dia" ADD CONSTRAINT "pedido_b2b_items_dia_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_b2b_items_dia" ADD CONSTRAINT "pedido_b2b_items_dia_pedidoB2bItemId_fkey" FOREIGN KEY ("pedidoB2bItemId") REFERENCES "pedido_b2b_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_b2b_codigos_descuento" ADD CONSTRAINT "pedido_b2b_codigos_descuento_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
