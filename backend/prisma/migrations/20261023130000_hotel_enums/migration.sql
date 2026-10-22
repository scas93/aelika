-- Hotel / reservas: nuevos valores de enum. Van en su propia migración: un valor recién agregado no puede usarse en la
-- misma transacción (la tabla de detalle y cualquier uso están en la migración siguiente).
ALTER TYPE "TipoStorefront" ADD VALUE 'HOTEL';
ALTER TYPE "TipoOrden" ADD VALUE 'RESERVA';
ALTER TYPE "MetodoPago" ADD VALUE 'EXTERNO';
