-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "bajaAt" TIMESTAMP(3),
ADD COLUMN     "codigo" TEXT,
ADD COLUMN     "descuentoPorcentaje" DECIMAL(5,2),
ADD COLUMN     "direccion" TEXT,
ADD COLUMN     "modalidadPago" "PedidoB2bModoCobro",
ALTER COLUMN "telefono" DROP NOT NULL;

-- AlterTable
ALTER TABLE "detalles_b2b" ADD COLUMN     "notaCliente" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "erpId" TEXT;

-- CreateTable
CREATE TABLE "cliente_telefonos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "principal" BOOLEAN NOT NULL DEFAULT false,
    "nombreContacto" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cliente_telefonos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cliente_telefonos_tenantId_telefono_idx" ON "cliente_telefonos"("tenantId", "telefono");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_telefonos_clienteId_telefono_key" ON "cliente_telefonos"("clienteId", "telefono");

-- CreateIndex
CREATE INDEX "clientes_tenantId_canal_bajaAt_idx" ON "clientes"("tenantId", "canal", "bajaAt");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_tenantId_codigo_key" ON "clientes"("tenantId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_erpId_key" ON "products"("tenantId", "erpId");

-- AddForeignKey
ALTER TABLE "cliente_telefonos" ADD CONSTRAINT "cliente_telefonos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cliente_telefonos" ADD CONSTRAINT "cliente_telefonos_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Prisma no modela CHECK ni índices parciales; viven aquí y en la base.
-- Un solo teléfono principal por cliente B2B.
CREATE UNIQUE INDEX "cliente_telefonos_un_principal_idx" ON "cliente_telefonos"("clienteId") WHERE "principal";

-- Un cliente B2C siempre trae teléfono. La contraparte (un B2B siempre trae código) se agrega en la entrega
-- 2d, cuando los pedidos B2B dejen de crear clientes por sincronización; antes, ese flujo todavía crea B2B sin código.
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_identidad_check" CHECK ("canal" <> 'B2C' OR "telefono" IS NOT NULL);
