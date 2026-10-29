-- Un negocio nuevo nace sin mínimo de piezas B2B (0 = sin mínimo). Solo cambia el DEFAULT de la columna:
-- no actualiza ninguna fila, así que los negocios existentes conservan su valor.
ALTER TABLE "tenants" ALTER COLUMN "pedidoB2bMinimoPiezas" SET DEFAULT 0;
