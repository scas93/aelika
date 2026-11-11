-- Los días que se pueden agendar pasan a ser por método de entrega (pickup / domicilio); ambos parten del valor actual.
ALTER TABLE "tenants" RENAME COLUMN "diasMaxAgendar" TO "diasMaxAgendarPickup";
ALTER TABLE "tenants" ADD COLUMN "diasMaxAgendarDomicilio" INTEGER NOT NULL DEFAULT 0;
UPDATE "tenants" SET "diasMaxAgendarDomicilio" = "diasMaxAgendarPickup";
