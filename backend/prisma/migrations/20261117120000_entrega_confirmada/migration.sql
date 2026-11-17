-- «Entrega confirmada» por correo al cliente B2B. Aditiva: un valor de enum, una columna con default false (todo arranca apagado,
-- también para clientes existentes) y una tabla nueva.
ALTER TYPE "NotificacionEvento" ADD VALUE 'ENTREGA_CONFIRMADA';

ALTER TABLE "clientes" ADD COLUMN "entregaConfirmadaActivo" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "EntregaConfirmadaEstado" AS ENUM ('EN_CURSO', 'EXITO', 'FALLO', 'OMITIDO');

CREATE TABLE "entrega_confirmada_envios" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entregaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "estado" "EntregaConfirmadaEstado" NOT NULL DEFAULT 'EN_CURSO',
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltoAt" TIMESTAMP(3),

    CONSTRAINT "entrega_confirmada_envios_pkey" PRIMARY KEY ("id")
);

-- Un registro por entrega: es la reserva que impide reenviar.
CREATE UNIQUE INDEX "entrega_confirmada_envios_entregaId_key" ON "entrega_confirmada_envios"("entregaId");
CREATE INDEX "entrega_confirmada_envios_tenantId_createdAt_idx" ON "entrega_confirmada_envios"("tenantId", "createdAt");

ALTER TABLE "entrega_confirmada_envios" ADD CONSTRAINT "entrega_confirmada_envios_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entrega_confirmada_envios" ADD CONSTRAINT "entrega_confirmada_envios_entregaId_fkey" FOREIGN KEY ("entregaId") REFERENCES "entregas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entrega_confirmada_envios" ADD CONSTRAINT "entrega_confirmada_envios_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
