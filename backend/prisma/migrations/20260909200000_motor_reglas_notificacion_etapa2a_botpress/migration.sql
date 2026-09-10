-- CreateEnum
CREATE TYPE "ReglaPlantillaVariableFuente" AS ENUM ('CAMPO_CLIENTE', 'VALOR_FIJO');

-- AlterEnum
BEGIN;
CREATE TYPE "ReglaEnvioEstado_new" AS ENUM ('EN_CURSO', 'EXITO', 'FALLO');
ALTER TABLE "public"."regla_envio_logs" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "regla_envio_logs" ALTER COLUMN "estado" TYPE "ReglaEnvioEstado_new" USING ("estado"::text::"ReglaEnvioEstado_new");
ALTER TYPE "ReglaEnvioEstado" RENAME TO "ReglaEnvioEstado_old";
ALTER TYPE "ReglaEnvioEstado_new" RENAME TO "ReglaEnvioEstado";
DROP TYPE "public"."ReglaEnvioEstado_old";
ALTER TABLE "regla_envio_logs" ALTER COLUMN "estado" SET DEFAULT 'EN_CURSO';
COMMIT;

-- AlterTable
ALTER TABLE "regla_envio_logs" ALTER COLUMN "estado" SET DEFAULT 'EN_CURSO';

-- AlterTable
ALTER TABLE "reglas" ADD COLUMN     "plantillaVariables" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "botWebhookSecret" TEXT,
ADD COLUMN     "botWebhookUrl" TEXT;

