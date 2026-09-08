-- CreateEnum
CREATE TYPE "ClienteCanal" AS ENUM ('B2C', 'B2B');

-- CreateTable
CREATE TABLE "clientes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "canal" "ClienteCanal" NOT NULL,
    "telefono" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "correo" TEXT,
    "primerPedidoAt" TIMESTAMP(3) NOT NULL,
    "ultimoPedidoAt" TIMESTAMP(3) NOT NULL,
    "totalPedidos" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clientes_tenantId_idx" ON "clientes"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_tenantId_canal_telefono_key" ON "clientes"("tenantId", "canal", "telefono");

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
