-- CreateEnum
CREATE TYPE "NotificacionCanalTipo" AS ENUM ('TELEGRAM', 'SMS', 'CORREO');

-- CreateEnum
CREATE TYPE "NotificacionEvento" AS ENUM ('PEDIDO_RECIBIDO', 'PEDIDO_CONFIRMADO');

-- CreateEnum
CREATE TYPE "NotificacionAudiencia" AS ENUM ('CLIENTE', 'NEGOCIO');

-- CreateTable
CREATE TABLE "notificacion_canal_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tipo" "NotificacionCanalTipo" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notificacion_canal_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacion_evento_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "evento" "NotificacionEvento" NOT NULL,
    "audiencia" "NotificacionAudiencia" NOT NULL,
    "canalConfigId" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notificacion_evento_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notificacion_canal_configs_tenantId_idx" ON "notificacion_canal_configs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "notificacion_canal_configs_tenantId_tipo_key" ON "notificacion_canal_configs"("tenantId", "tipo");

-- CreateIndex
CREATE INDEX "notificacion_evento_configs_tenantId_idx" ON "notificacion_evento_configs"("tenantId");

-- CreateIndex
CREATE INDEX "notificacion_evento_configs_canalConfigId_idx" ON "notificacion_evento_configs"("canalConfigId");

-- CreateIndex
CREATE UNIQUE INDEX "notificacion_evento_configs_tenantId_evento_audiencia_canal_key" ON "notificacion_evento_configs"("tenantId", "evento", "audiencia", "canalConfigId");

-- AddForeignKey
ALTER TABLE "notificacion_canal_configs" ADD CONSTRAINT "notificacion_canal_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacion_evento_configs" ADD CONSTRAINT "notificacion_evento_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacion_evento_configs" ADD CONSTRAINT "notificacion_evento_configs_canalConfigId_fkey" FOREIGN KEY ("canalConfigId") REFERENCES "notificacion_canal_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
