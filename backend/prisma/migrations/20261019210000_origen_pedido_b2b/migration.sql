-- Origen del pedido B2B (observabilidad del Dueño). Aditiva: un tipo nuevo y una columna NULL sin default.
-- Sin relleno retroactivo: los pedidos anteriores quedan sin dato.
CREATE TYPE "OrigenPedidoB2b" AS ENUM ('PORTAL_CLIENTE', 'PANEL_EQUIPO');

ALTER TABLE "detalles_b2b" ADD COLUMN "origen" "OrigenPedidoB2b";
