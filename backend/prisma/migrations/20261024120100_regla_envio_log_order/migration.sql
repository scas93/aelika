-- Reserva asociada a un envío de regla (dedupe "un envío por regla y reserva"). Aditiva; las filas existentes quedan en NULL.
ALTER TABLE "regla_envio_logs" ADD COLUMN "orderId" TEXT;
ALTER TABLE "regla_envio_logs" ADD CONSTRAINT "regla_envio_logs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "regla_envio_logs_reglaId_orderId_idx" ON "regla_envio_logs"("reglaId", "orderId");
