-- Etapa 1 · verificación POST-MIGRACIÓN (SOLO LECTURA). Cada bloque `-- @nombre: descripción`
-- es UNA consulta; el runner (verificar-runner.mjs) las ejecuta dentro de BEGIN READ ONLY.
-- También se puede correr a mano con psql. Sin punto y coma dentro de comentarios.
--
-- Corte: finished_at de la migración en _prisma_migrations. Las órdenes SIN detalle creadas
-- ANTES del corte deben ser 0 (las cubrió el backfill). Las creadas DESPUÉS son las del
-- traslape del despliegue de la Etapa 1 (ya se rellenaron; desde la 1b-a una orden sin detalle es una
-- inconsistencia y la API responde 500 / la omite de las listas, ver orders/order-respuesta.ts).
--
-- Etapa 1b-a: desde que se retira la escritura doble, las órdenes NUEVAS dejan las columnas viejas en su valor
-- por defecto, así que compararlas contra el detalle marcaría diferencias falsas. El runner sustituye
-- __CORTE_1BA__ por el parámetro --hasta (momento del despliegue de la 1b-a): la comparación de campos solo
-- cubre órdenes creadas ANTES de ese instante. Sin --hasta es 'infinity' (comportamiento anterior).

-- @conteos: orders vs detalles_b2c
SELECT
  (SELECT count(*) FROM "orders") AS orders,
  (SELECT count(*) FROM "detalles_b2c") AS detalles_b2c,
  (SELECT count(*) FROM "orders" o WHERE EXISTS (SELECT 1 FROM "detalles_b2c" d WHERE d."orderId" = o."id")) AS orders_con_detalle;

-- @corte: finished_at de la migración (punto de corte)
SELECT "migration_name", "finished_at" FROM "_prisma_migrations" WHERE "migration_name" = '20260930120000_etapa1_detalles_b2c';

-- @ordenes_sin_detalle: lista de folios sin detalle y si son anteriores al corte
SELECT o."tenantId", o."folio", o."createdAt",
       (o."createdAt" < m."finished_at") AS antes_del_corte
FROM "orders" o
LEFT JOIN "detalles_b2c" d ON d."orderId" = o."id"
CROSS JOIN (SELECT "finished_at" FROM "_prisma_migrations" WHERE "migration_name" = '20260930120000_etapa1_detalles_b2c') m
WHERE d."id" IS NULL
ORDER BY o."createdAt";

-- @sin_detalle_resumen: sin detalle antes del corte (DEBE ser 0) y despues del corte (traslape)
SELECT
  count(*) FILTER (WHERE o."createdAt" < m."finished_at") AS sin_detalle_antes_del_corte,
  count(*) FILTER (WHERE o."createdAt" >= m."finished_at") AS sin_detalle_despues_del_corte
FROM "orders" o
LEFT JOIN "detalles_b2c" d ON d."orderId" = o."id"
CROSS JOIN (SELECT "finished_at" FROM "_prisma_migrations" WHERE "migration_name" = '20260930120000_etapa1_detalles_b2c') m
WHERE d."id" IS NULL;

-- @detalles_huerfanos: detalles cuya orden no existe (DEBE ser 0)
SELECT count(*) AS detalles_huerfanos
FROM "detalles_b2c" d LEFT JOIN "orders" o ON o."id" = d."orderId"
WHERE o."id" IS NULL;

-- @detalles_duplicados: ordenes con mas de un detalle (DEBE ser 0)
SELECT count(*) AS ordenes_con_mas_de_un_detalle
FROM (SELECT "orderId" FROM "detalles_b2c" GROUP BY "orderId" HAVING count(*) > 1) x;

-- @campos_distintos: por campo, cuantos detalles difieren de la columna vieja de su orden, solo ordenes anteriores al corte 1b-a (TODOS DEBEN ser 0; IS DISTINCT FROM trata NULL bien)
SELECT
  count(*) AS filas_comparadas,
  count(*) FILTER (WHERE d."tenantId" IS DISTINCT FROM o."tenantId") AS "tenantId",
  count(*) FILTER (WHERE d."horaRecogidaTipo" IS DISTINCT FROM o."horaRecogidaTipo") AS "horaRecogidaTipo",
  count(*) FILTER (WHERE d."horaRecogida" IS DISTINCT FROM o."horaRecogida") AS "horaRecogida",
  count(*) FILTER (WHERE d."metodoEntrega" IS DISTINCT FROM o."metodoEntrega") AS "metodoEntrega",
  count(*) FILTER (WHERE d."puntoEnvioId" IS DISTINCT FROM o."puntoEnvioId") AS "puntoEnvioId",
  count(*) FILTER (WHERE d."direccionCalle" IS DISTINCT FROM o."direccionCalle") AS "direccionCalle",
  count(*) FILTER (WHERE d."direccionNumero" IS DISTINCT FROM o."direccionNumero") AS "direccionNumero",
  count(*) FILTER (WHERE d."direccionColonia" IS DISTINCT FROM o."direccionColonia") AS "direccionColonia",
  count(*) FILTER (WHERE d."direccionReferencias" IS DISTINCT FROM o."direccionReferencias") AS "direccionReferencias",
  count(*) FILTER (WHERE d."notasDescuento" IS DISTINCT FROM o."notasDescuento") AS "notasDescuento"
FROM "detalles_b2c" d JOIN "orders" o ON o."id" = d."orderId"
WHERE o."createdAt" < __CORTE_1BA__;

-- @ordenes_desde_el_corte: ordenes creadas desde el corte de la 1b-a (excluidas de la comparacion de campos; solo informativo)
SELECT count(*) AS ordenes_desde_el_corte_1ba FROM "orders" o WHERE o."createdAt" >= __CORTE_1BA__;

-- @suma_total_por_tenant: ordenes y suma de total por tenant (comparar contra la linea base previa)
SELECT "tenantId", count(*) AS ordenes, sum("total") AS suma_total FROM "orders" GROUP BY "tenantId" ORDER BY "tenantId";

-- @conteo_por_tipo: todas las ordenes de esta etapa deben ser B2C
SELECT "tipo", count(*) AS ordenes FROM "orders" GROUP BY "tipo" ORDER BY "tipo";
