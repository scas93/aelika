-- Reglas ESTADO_CLIENTE sin reenvío horario: tabla de quién cumple cada regla + marca de "base sin enviar".
-- Aditiva. Las reglas ESTADO_CLIENTE activas al desplegar quedan con estadoBasePendiente = true: su primer barrido
-- registra a quienes ya cumplen el filtro SIN enviar nada (solo reciben los que entren después).
ALTER TABLE "reglas" ADD COLUMN "estadoBasePendiente" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "regla_cliente_estados" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reglaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "cumpleDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regla_cliente_estados_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "regla_cliente_estados_reglaId_clienteId_key" ON "regla_cliente_estados"("reglaId", "clienteId");
CREATE INDEX "regla_cliente_estados_tenantId_idx" ON "regla_cliente_estados"("tenantId");

ALTER TABLE "regla_cliente_estados" ADD CONSTRAINT "regla_cliente_estados_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "regla_cliente_estados" ADD CONSTRAINT "regla_cliente_estados_reglaId_fkey" FOREIGN KEY ("reglaId") REFERENCES "reglas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "regla_cliente_estados" ADD CONSTRAINT "regla_cliente_estados_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "reglas" SET "estadoBasePendiente" = true WHERE "trigger" = 'ESTADO_CLIENTE' AND "activa" = true;
