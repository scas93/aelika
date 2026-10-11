-- Fase 4 · 4b: sesión definitiva del portal del cliente B2B y parámetros de la plantilla del código de acceso.
-- Retira la tabla temporal de la prueba de sesión de la 4a (solo staging; sin datos que conservar).

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "portalPlantillaIdioma" TEXT,
ADD COLUMN     "portalPlantillaNombre" TEXT;

-- DropTable
DROP TABLE "sesiones_prueba";

-- CreateTable
CREATE TABLE "sesiones_portal" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "clienteId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "dispositivoId" TEXT,
    "userAgent" TEXT,
    "creadaAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUsoAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "venceAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sesiones_portal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_portal_tokenHash_key" ON "sesiones_portal"("tokenHash");

-- CreateIndex
CREATE INDEX "sesiones_portal_tenantId_telefono_idx" ON "sesiones_portal"("tenantId", "telefono");

-- AddForeignKey
ALTER TABLE "sesiones_portal" ADD CONSTRAINT "sesiones_portal_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sesiones_portal" ADD CONSTRAINT "sesiones_portal_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
