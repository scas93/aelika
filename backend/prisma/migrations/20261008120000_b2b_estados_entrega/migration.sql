-- Estados B2B por entrega: solo agrega valores (aditiva, sin DROP). Los datos se migran con
-- src/scripts/b2b-estados.ts (idempotente); el código tolera B2B DESPACHADO como COMPLETADO mientras tanto.
ALTER TYPE "EstadoPedido" ADD VALUE IF NOT EXISTS 'EN_PROCESO';
ALTER TYPE "EstadoPedido" ADD VALUE IF NOT EXISTS 'COMPLETADO';
ALTER TYPE "EstadoEntrega" ADD VALUE IF NOT EXISTS 'NO_RECOGIDA';
