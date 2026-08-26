-- CreateEnum
CREATE TYPE "TipoStorefront" AS ENUM ('RETAIL_B2C', 'RETAIL_B2B');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "tipoStorefront" "TipoStorefront" NOT NULL DEFAULT 'RETAIL_B2C';
