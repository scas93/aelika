-- Nota por producto (solo B2C): instrucción libre del cliente para una línea del pedido. Aditiva: columna NULL sin default,
-- sin relleno retroactivo (los pedidos anteriores y todo B2B quedan en NULL).
ALTER TABLE "order_items" ADD COLUMN "nota" TEXT;
