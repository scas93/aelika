-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "pinBloqueadoHasta" TIMESTAMP(3),
ADD COLUMN     "pinIntentosFallidos" INTEGER NOT NULL DEFAULT 0;
