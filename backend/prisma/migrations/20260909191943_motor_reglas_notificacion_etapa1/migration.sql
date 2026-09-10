-- CreateEnum
CREATE TYPE "ReglaTriggerTipo" AS ENUM ('EVENTO_PEDIDO', 'ESTADO_CLIENTE', 'FECHA_PROGRAMADA', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReglaMensajeCategoria" AS ENUM ('UTILITY', 'MARKETING');

-- CreateEnum
CREATE TYPE "ReglaCanal" AS ENUM ('WHATSAPP');

-- CreateEnum
CREATE TYPE "ReglaTriggerOrigenPedido" AS ENUM ('ORDER', 'PEDIDO_B2B');

-- CreateEnum
CREATE TYPE "ReglaFiltroCampo" AS ENUM ('TOTAL_PEDIDOS', 'ULTIMO_PEDIDO_ANTIGUEDAD_DIAS', 'PRIMER_PEDIDO_ANTIGUEDAD_DIAS');

-- CreateEnum
CREATE TYPE "ReglaFiltroOperador" AS ENUM ('MAYOR_IGUAL', 'MENOR_IGUAL', 'IGUAL');

-- CreateEnum
CREATE TYPE "ReglaEnvioEstado" AS ENUM ('REGISTRADO');

-- CreateTable
CREATE TABLE "reglas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "trigger" "ReglaTriggerTipo" NOT NULL,
    "triggerConfig" JSONB,
    "filtro" JSONB NOT NULL,
    "canal" "ReglaCanal" NOT NULL DEFAULT 'WHATSAPP',
    "plantillaNombre" TEXT NOT NULL,
    "plantillaIdioma" TEXT NOT NULL,
    "plantillaCategoria" "ReglaMensajeCategoria" NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reglas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regla_envio_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "reglaId" TEXT,
    "categoria" "ReglaMensajeCategoria" NOT NULL,
    "estado" "ReglaEnvioEstado" NOT NULL DEFAULT 'REGISTRADO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regla_envio_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reglas_tenantId_idx" ON "reglas"("tenantId");

-- CreateIndex
CREATE INDEX "regla_envio_logs_tenantId_clienteId_categoria_createdAt_idx" ON "regla_envio_logs"("tenantId", "clienteId", "categoria", "createdAt");

-- AddForeignKey
ALTER TABLE "reglas" ADD CONSTRAINT "reglas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regla_envio_logs" ADD CONSTRAINT "regla_envio_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regla_envio_logs" ADD CONSTRAINT "regla_envio_logs_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regla_envio_logs" ADD CONSTRAINT "regla_envio_logs_reglaId_fkey" FOREIGN KEY ("reglaId") REFERENCES "reglas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
