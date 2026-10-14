-- Todo cliente B2B tiene código (los da de alta un admin; ya no se crean por sincronización con pedidos).
-- Reemplaza la CHECK de la 2a (que solo exigía teléfono a los B2C).
-- NOT VALID a propósito: se exige a toda fila nueva o modificada, pero el despliegue no falla si todavía hay clientes B2B
-- viejos sin código (datos de prueba). Tras limpiarlos: ALTER TABLE "clientes" VALIDATE CONSTRAINT "clientes_identidad_check"
-- (lo hace el script limpiar-b2b-prueba.ts al terminar una limpieza completa).
ALTER TABLE "clientes" DROP CONSTRAINT "clientes_identidad_check";
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_identidad_check"
  CHECK (("canal" = 'B2C' AND "telefono" IS NOT NULL) OR ("canal" = 'B2B' AND "codigo" IS NOT NULL)) NOT VALID;
