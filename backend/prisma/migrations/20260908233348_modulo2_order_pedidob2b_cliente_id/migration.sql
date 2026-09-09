-- Order.clienteId / PedidoB2b.clienteId: required FK to Cliente (Módulo 2).
-- Hand-written (not a plain `prisma migrate dev`) for the same reason as
-- 20260818174155_tenant_bot_api_key and 20260819183000_facturacion_envio_
-- metodopago: existing rows need a real value before NOT NULL can be added.
--
-- Unlike tenant_bot_api_key (fresh random value per row) this needs to
-- resolve each existing Order/PedidoB2b to its Cliente by (tenantId, canal,
-- telefono) — the same identity ClientesService.sincronizarDesdePedido uses.
-- Checked against the real data before writing this: none of the 26
-- existing Order/PedidoB2b rows have a matching Cliente today (the sync
-- hook only runs going forward, from the moment Módulo 1 Etapa 1 shipped —
-- it never ran retroactively over pre-existing pedidos), so this migration
-- also has to CREATE the missing Cliente rows, not just link to existing
-- ones. The aggregation below intentionally mirrors
-- ClientesService.sincronizarDesdePedido's semantics exactly: nombre comes
-- from the chronologically last pedido for that (tenantId, canal,
-- telefono); correo comes from the chronologically last pedido that HAD a
-- non-null correo (never overwritten by a later pedido with no correo,
-- same rule the service applies going forward); primerPedidoAt/
-- ultimoPedidoAt/totalPedidos are min/max/count over the group.
--
-- ON CONFLICT DO NOTHING on the Cliente insert: defensive only, in case this
-- ever runs against a database where the sync hook already created some of
-- these Cliente rows (not the case today, but the insert shouldn't assume
-- it never will be) — in that case the existing (live) Cliente row wins,
-- this migration only fills in what's actually missing.

-- AlterTable: add nullable first, backfill below, then SET NOT NULL.
ALTER TABLE "orders" ADD COLUMN "clienteId" TEXT;

-- AlterTable
ALTER TABLE "pedidos_b2b" ADD COLUMN "clienteId" TEXT;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Backfill missing Cliente rows — canal B2C, from Order.
INSERT INTO "clientes" ("id", "tenantId", "canal", "telefono", "nombre", "correo", "primerPedidoAt", "ultimoPedidoAt", "totalPedidos", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  agg."tenantId",
  'B2C'::"ClienteCanal",
  agg."telefono",
  ultimo."clienteNombre",
  ultimoConCorreo."clienteCorreo",
  agg."primerPedidoAt",
  agg."ultimoPedidoAt",
  agg."totalPedidos",
  now(),
  now()
FROM (
  SELECT "tenantId", "clienteTelefono" AS "telefono",
         min("createdAt") AS "primerPedidoAt",
         max("createdAt") AS "ultimoPedidoAt",
         count(*) AS "totalPedidos"
  FROM "orders"
  GROUP BY "tenantId", "clienteTelefono"
) agg
JOIN LATERAL (
  SELECT o."clienteNombre"
  FROM "orders" o
  WHERE o."tenantId" = agg."tenantId" AND o."clienteTelefono" = agg."telefono"
  ORDER BY o."createdAt" DESC, o."id" DESC
  LIMIT 1
) ultimo ON true
LEFT JOIN LATERAL (
  SELECT o."clienteCorreo"
  FROM "orders" o
  WHERE o."tenantId" = agg."tenantId" AND o."clienteTelefono" = agg."telefono" AND o."clienteCorreo" IS NOT NULL
  ORDER BY o."createdAt" DESC, o."id" DESC
  LIMIT 1
) ultimoConCorreo ON true
ON CONFLICT ("tenantId", "canal", "telefono") DO NOTHING;

-- Backfill missing Cliente rows — canal B2B, from PedidoB2b. contactoCorreo
-- is never null (required at the DTO level, see CreatePedidoB2bDto), so the
-- "last non-null correo" lateral isn't strictly needed here, but kept for
-- the same reason/shape as the B2C block above — consistent, and correct
-- even if that constraint were ever relaxed.
INSERT INTO "clientes" ("id", "tenantId", "canal", "telefono", "nombre", "correo", "primerPedidoAt", "ultimoPedidoAt", "totalPedidos", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  agg."tenantId",
  'B2B'::"ClienteCanal",
  agg."telefono",
  ultimo."contactoNombre",
  ultimoConCorreo."contactoCorreo",
  agg."primerPedidoAt",
  agg."ultimoPedidoAt",
  agg."totalPedidos",
  now(),
  now()
FROM (
  SELECT "tenantId", "contactoTelefono" AS "telefono",
         min("createdAt") AS "primerPedidoAt",
         max("createdAt") AS "ultimoPedidoAt",
         count(*) AS "totalPedidos"
  FROM "pedidos_b2b"
  GROUP BY "tenantId", "contactoTelefono"
) agg
JOIN LATERAL (
  SELECT p."contactoNombre"
  FROM "pedidos_b2b" p
  WHERE p."tenantId" = agg."tenantId" AND p."contactoTelefono" = agg."telefono"
  ORDER BY p."createdAt" DESC, p."id" DESC
  LIMIT 1
) ultimo ON true
LEFT JOIN LATERAL (
  SELECT p."contactoCorreo"
  FROM "pedidos_b2b" p
  WHERE p."tenantId" = agg."tenantId" AND p."contactoTelefono" = agg."telefono" AND p."contactoCorreo" IS NOT NULL
  ORDER BY p."createdAt" DESC, p."id" DESC
  LIMIT 1
) ultimoConCorreo ON true
ON CONFLICT ("tenantId", "canal", "telefono") DO NOTHING;

-- Link every existing Order/PedidoB2b to its (now guaranteed to exist) Cliente.
UPDATE "orders" o
SET "clienteId" = c."id"
FROM "clientes" c
WHERE c."tenantId" = o."tenantId" AND c."canal" = 'B2C' AND c."telefono" = o."clienteTelefono";

UPDATE "pedidos_b2b" p
SET "clienteId" = c."id"
FROM "clientes" c
WHERE c."tenantId" = p."tenantId" AND c."canal" = 'B2B' AND c."telefono" = p."contactoTelefono";

-- Every row now has a clienteId — enforce it from here on.
ALTER TABLE "orders" ALTER COLUMN "clienteId" SET NOT NULL;
ALTER TABLE "pedidos_b2b" ALTER COLUMN "clienteId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "orders_clienteId_idx" ON "orders"("clienteId");

-- CreateIndex
CREATE INDEX "pedidos_b2b_clienteId_idx" ON "pedidos_b2b"("clienteId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_b2b" ADD CONSTRAINT "pedidos_b2b_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
