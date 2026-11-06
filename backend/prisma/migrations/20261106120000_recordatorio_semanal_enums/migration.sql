-- Recordatorio semanal de pedido (solo mayoreo): valores de enum nuevos (solos en su migración: no se pueden usar en la misma transacción).
ALTER TYPE "ReglaTriggerTipo" ADD VALUE 'RECORDATORIO_SEMANAL_PEDIDO';
ALTER TYPE "ReglaPlantillaVariableFuente" ADD VALUE 'SEMANA_SIGUIENTE';
