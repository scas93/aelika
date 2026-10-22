-- Trigger automático sobre reservas de hotel: valores de enum nuevos (solos en su migración: no se pueden usar en la misma transacción).
ALTER TYPE "ReglaTriggerTipo" ADD VALUE 'RESERVA_AUTOMATICA';
ALTER TYPE "ReglaPlantillaVariableFuente" ADD VALUE 'CAMPO_RESERVA';
