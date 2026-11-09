-- «Cambios desde la última revisión» (B2B): referencia del pedido previa a la primera modificación del cliente. Solo aditiva.
CREATE TABLE "pedido_b2b_referencias" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pedido_b2b_referencias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pedido_b2b_referencias_orderId_key" ON "pedido_b2b_referencias"("orderId");
CREATE INDEX "pedido_b2b_referencias_tenantId_idx" ON "pedido_b2b_referencias"("tenantId");

ALTER TABLE "pedido_b2b_referencias" ADD CONSTRAINT "pedido_b2b_referencias_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pedido_b2b_referencias" ADD CONSTRAINT "pedido_b2b_referencias_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
