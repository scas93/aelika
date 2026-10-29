-- Días sin entrega (festivos) de los negocios B2B. Aditiva: tabla e índice único nuevos.
-- CreateTable
CREATE TABLE "dias_sin_entrega" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "nota" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dias_sin_entrega_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dias_sin_entrega_tenantId_fecha_key" ON "dias_sin_entrega"("tenantId", "fecha");

-- AddForeignKey
ALTER TABLE "dias_sin_entrega" ADD CONSTRAINT "dias_sin_entrega_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
