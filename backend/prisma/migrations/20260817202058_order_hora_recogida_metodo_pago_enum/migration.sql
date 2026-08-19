-- Order.horaRecogida moves from a full DateTime to a same-day "HH:mm" string
-- (paired with the new horaRecogidaTipo), and Order.metodoPago moves from a
-- free-text string to a real enum. Hand-written (not `prisma migrate dev`)
-- so existing rows convert their data instead of losing it.

-- CreateEnum
CREATE TYPE "HoraRecogidaTipo" AS ENUM ('LO_ANTES_POSIBLE', 'HORA_ESPECIFICA');

-- CreateEnum
CREATE TYPE "MetodoPago" AS ENUM ('AL_RECOGER', 'PAGO_EN_LINEA');

-- AlterTable: horaRecogidaTipo (every existing order predates this feature,
-- so they're all "as soon as possible" by definition)
ALTER TABLE "orders" ADD COLUMN "horaRecogidaTipo" "HoraRecogidaTipo" NOT NULL DEFAULT 'LO_ANTES_POSIBLE';

-- AlterTable: horaRecogida DateTime -> "HH:mm" text (NULL stays NULL)
ALTER TABLE "orders" ALTER COLUMN "horaRecogida" TYPE TEXT USING to_char("horaRecogida", 'HH24:MI');

-- AlterTable: metodoPago free text -> enum (only 'al_recoger' was ever written)
ALTER TABLE "orders" ALTER COLUMN "metodoPago" DROP DEFAULT;
ALTER TABLE "orders" ALTER COLUMN "metodoPago" TYPE "MetodoPago" USING (UPPER("metodoPago"))::"MetodoPago";
ALTER TABLE "orders" ALTER COLUMN "metodoPago" SET DEFAULT 'AL_RECOGER';
