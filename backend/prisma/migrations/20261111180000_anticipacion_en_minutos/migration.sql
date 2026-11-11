-- La anticipación mínima de entrega pasa de horas a minutos (para poder pedir 15 min, 1 h 15 min, etc.).
ALTER TABLE "tenants" RENAME COLUMN "anticipacionPickupHoras" TO "anticipacionPickupMinutos";
ALTER TABLE "tenants" RENAME COLUMN "anticipacionDomicilioHoras" TO "anticipacionDomicilioMinutos";
UPDATE "tenants" SET "anticipacionPickupMinutos" = "anticipacionPickupMinutos" * 60,
                     "anticipacionDomicilioMinutos" = "anticipacionDomicilioMinutos" * 60;
