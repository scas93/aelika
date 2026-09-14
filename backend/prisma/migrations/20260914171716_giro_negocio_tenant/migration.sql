-- CreateEnum
CREATE TYPE "GiroNegocio" AS ENUM ('RESTAURANTE', 'CAFETERIA', 'HOTEL', 'RENTA_VACACIONAL', 'MAYORISTA', 'OTRO');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "giroNegocio" "GiroNegocio";
