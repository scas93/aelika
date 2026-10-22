-- Configuración de pagos, Fase 0: modalidades de cobro B2B activas por negocio. Aditiva (una columna con default).
-- Los negocios existentes quedan con ["AL_FINAL"] hasta que corra src/scripts/modalidades-cobro-b2b.ts, que deja activa
-- solo la modalidad de su pedidoB2bModoCobro actual y asigna modalidad a los clientes B2B que tienen NULL.
ALTER TABLE "tenants" ADD COLUMN "modalidadesCobroB2b" JSONB NOT NULL DEFAULT '["AL_FINAL"]';
