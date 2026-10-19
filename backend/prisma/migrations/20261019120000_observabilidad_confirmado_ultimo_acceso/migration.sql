-- Observabilidad del Dueño (aditiva, nullable, sin default, sin tocar datos existentes).
-- Primera confirmación de un pedido B2B (solo pedidos creados después del corte CONFIRMADO_AT_DESDE).
ALTER TABLE "detalles_b2b" ADD COLUMN "confirmadoAt" TIMESTAMP(3);

-- Último acceso del cliente B2B al portal (como cliente activo).
ALTER TABLE "clientes" ADD COLUMN "ultimoAccesoAt" TIMESTAMP(3);
