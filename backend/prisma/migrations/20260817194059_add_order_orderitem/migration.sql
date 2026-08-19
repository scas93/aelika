-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('PENDIENTE_CONFIRMACION', 'CONFIRMADO_SURTIENDO', 'LISTO_ENTREGA', 'DESPACHADO');

-- CreateEnum
CREATE TYPE "CanalOrigen" AS ENUM ('WEB', 'WHATSAPP', 'INSTAGRAM', 'FACEBOOK');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "folio" TEXT NOT NULL,
    "clienteNombre" TEXT NOT NULL,
    "clienteTelefono" TEXT NOT NULL,
    "notas" TEXT,
    "horaRecogida" TIMESTAMP(3),
    "metodoPago" TEXT NOT NULL DEFAULT 'pago_en_tienda',
    "estadoPedido" "EstadoPedido" NOT NULL DEFAULT 'PENDIENTE_CONFIRMACION',
    "canalOrigen" "CanalOrigen" NOT NULL DEFAULT 'WEB',
    "total" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "nombreProducto" TEXT NOT NULL,
    "precioUnitario" DECIMAL(10,2) NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_tenantId_idx" ON "orders"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenantId_folio_key" ON "orders"("tenantId", "folio");

-- CreateIndex
CREATE INDEX "order_items_tenantId_idx" ON "order_items"("tenantId");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
