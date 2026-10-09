-- Pago de pedidos B2B (Fase 1b): fecha y hora en que se marcó Pagado. Aditiva; los pedidos ya pagados quedan con NULL (fecha no registrada).
ALTER TABLE "detalles_b2b" ADD COLUMN     "pagadoAt" TIMESTAMP(3);
