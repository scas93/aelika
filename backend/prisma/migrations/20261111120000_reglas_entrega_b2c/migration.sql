-- Reglas de entrega del menudeo (B2C): anticipación mínima por método, días máximos para agendar y fecha de entrega
-- del pedido. Solo aditiva, con defaults que conservan el comportamiento actual (sin anticipación, solo hoy).
ALTER TABLE "tenants" ADD COLUMN "anticipacionPickupHoras" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "anticipacionDomicilioHoras" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "diasMaxAgendar" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "detalles_b2c" ADD COLUMN "fechaEntrega" TEXT;
