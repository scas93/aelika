-- Aditiva. Botón de URL dinámica opcional por regla (null = sin botón, como todas las reglas existentes).
ALTER TABLE "reglas" ADD COLUMN "botonUrlValor" TEXT;

-- Semana a la que se refiere un envío de recordatorio semanal (null en el resto de los envíos).
ALTER TABLE "regla_envio_logs" ADD COLUMN "semanaInicio" DATE;

-- Un envío por (regla, cliente, semana). Los NULL son distintos entre sí en Postgres: los envíos sin semana nunca chocan.
CREATE UNIQUE INDEX "regla_envio_logs_reglaId_clienteId_semanaInicio_key" ON "regla_envio_logs"("reglaId", "clienteId", "semanaInicio");
