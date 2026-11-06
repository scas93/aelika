-- Resumen semanal por correo para cada cliente B2B. Aditiva (columnas nuevas con default/NULL y una tabla nueva).
ALTER TABLE "tenants" ADD COLUMN "correoRespuestas" TEXT;

ALTER TABLE "clientes" ADD COLUMN "resumenSemanalActivo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clientes" ADD COLUMN "resumenSemanalCorreo" TEXT;
ALTER TABLE "clientes" ADD COLUMN "resumenSemanalActivadoAt" TIMESTAMP(3);

CREATE TABLE "resumen_semanal_cliente_envios" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "semanaInicio" DATE NOT NULL,
    "estado" "ResumenSemanalEstado" NOT NULL DEFAULT 'EN_CURSO',
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltoAt" TIMESTAMP(3),

    CONSTRAINT "resumen_semanal_cliente_envios_pkey" PRIMARY KEY ("id")
);

-- Un resumen programado por cliente y semana.
CREATE UNIQUE INDEX "resumen_semanal_cliente_envios_clienteId_semanaInicio_key" ON "resumen_semanal_cliente_envios"("clienteId", "semanaInicio");
CREATE INDEX "resumen_semanal_cliente_envios_tenantId_createdAt_idx" ON "resumen_semanal_cliente_envios"("tenantId", "createdAt");

ALTER TABLE "resumen_semanal_cliente_envios" ADD CONSTRAINT "resumen_semanal_cliente_envios_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "resumen_semanal_cliente_envios" ADD CONSTRAINT "resumen_semanal_cliente_envios_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
