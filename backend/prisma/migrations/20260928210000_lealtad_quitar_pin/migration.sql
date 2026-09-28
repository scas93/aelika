-- Se retira el PIN de Lealtad y su rate-limit: registrar-compra/redimir-premio
-- quedan protegidos solo por sesión (JWT), rol y tenant.
-- AlterTable
ALTER TABLE "tenants" DROP COLUMN "pinBloqueadoHasta",
DROP COLUMN "pinIntentosFallidos",
DROP COLUMN "pinLealtad";
