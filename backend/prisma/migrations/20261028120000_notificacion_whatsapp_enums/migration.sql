-- Avisos internos por WhatsApp (mayoreo): valores de enum nuevos (solos en su migración: no se pueden usar en la misma transacción).
ALTER TYPE "NotificacionCanalTipo" ADD VALUE 'WHATSAPP';
ALTER TYPE "NotificacionEvento" ADD VALUE 'PEDIDO_MODIFICADO_CLIENTE';
