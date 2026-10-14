-- Fase 4 · 4f: marca «Modificado por el cliente» (aditiva, nullable, sin default).
ALTER TABLE "orders" ADD COLUMN "modificadoPorClienteAt" TIMESTAMP(3);
