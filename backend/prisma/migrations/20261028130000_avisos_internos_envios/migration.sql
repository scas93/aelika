-- Avisos internos por WhatsApp (Cambio C): registro de cada envío por destinatario. Aditiva: tabla, enum e índices nuevos.
-- CreateEnum
CREATE TYPE "EstadoAvisoInterno" AS ENUM ('EN_CURSO', 'EXITO', 'FALLO');

-- CreateTable
CREATE TABLE "avisos_internos_envios" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT,
    "canalConfigId" TEXT,
    "evento" "NotificacionEvento" NOT NULL,
    "folio" TEXT,
    "negocioNombre" TEXT,
    "destinatarioId" TEXT NOT NULL,
    "destinatarioNombre" TEXT NOT NULL,
    "telefonoUltimos4" TEXT NOT NULL,
    "estado" "EstadoAvisoInterno" NOT NULL DEFAULT 'EN_CURSO',
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltoAt" TIMESTAMP(3),

    CONSTRAINT "avisos_internos_envios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avisos_internos_envios_tenantId_orderId_idx" ON "avisos_internos_envios"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "avisos_internos_envios_tenantId_createdAt_idx" ON "avisos_internos_envios"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "avisos_internos_envios" ADD CONSTRAINT "avisos_internos_envios_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos_internos_envios" ADD CONSTRAINT "avisos_internos_envios_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos_internos_envios" ADD CONSTRAINT "avisos_internos_envios_canalConfigId_fkey" FOREIGN KEY ("canalConfigId") REFERENCES "notificacion_canal_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
