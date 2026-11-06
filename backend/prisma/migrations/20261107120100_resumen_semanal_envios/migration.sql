-- Resumen semanal por correo (mayoreo): registro de envíos. Aditiva (tabla y enums nuevos).
CREATE TYPE "ResumenSemanalTipo" AS ENUM ('PROGRAMADO', 'PRUEBA');
CREATE TYPE "ResumenSemanalEstado" AS ENUM ('EN_CURSO', 'EXITO', 'FALLO');

CREATE TABLE "resumen_semanal_envios" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "semanaInicio" DATE NOT NULL,
    "semanaProgramada" DATE,
    "tipo" "ResumenSemanalTipo" NOT NULL,
    "estado" "ResumenSemanalEstado" NOT NULL DEFAULT 'EN_CURSO',
    "motivo" TEXT,
    "destinatarios" INTEGER NOT NULL,
    "conPedidos" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltoAt" TIMESTAMP(3),

    CONSTRAINT "resumen_semanal_envios_pkey" PRIMARY KEY ("id")
);

-- Un resumen PROGRAMADO por negocio y semana. Los NULL (pruebas) son distintos entre sí en Postgres: nunca chocan.
CREATE UNIQUE INDEX "resumen_semanal_envios_tenantId_semanaProgramada_key" ON "resumen_semanal_envios"("tenantId", "semanaProgramada");
CREATE INDEX "resumen_semanal_envios_tenantId_createdAt_idx" ON "resumen_semanal_envios"("tenantId", "createdAt");

ALTER TABLE "resumen_semanal_envios" ADD CONSTRAINT "resumen_semanal_envios_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
