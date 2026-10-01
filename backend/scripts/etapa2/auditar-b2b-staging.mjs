#!/usr/bin/env node
// Auditoría 0c (SOLO LECTURA): estado de datos B2B y cobertura de variantes. Todo en BEGIN READ ONLY.
// Sin datos personales: ids truncados, folios, fechas, montos, estados y conteos.
//
// En Railway (staging): ver README.md. Local: SEED_ENTORNO_LOCAL=1 DATABASE_URL=postgresql://...localhost... node auditar-b2b-staging.mjs
import { Client, guardaProyecto } from './comun.mjs';

guardaProyecto();
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query('BEGIN READ ONLY');
const out = {};
const q = async (n, sql) => { out[n] = (await c.query(sql)).rows; };

await q('tenants_b2b', `select left(t.id,8) id, t.slug, t."tipoStorefront" tipo, t."pedidoB2bModoCobro" modo, t."pedidoB2bMinimoPiezas" minpz, t."facturacionModo" fact,
  t."pedidoB2bVentanaAperturaDia" ap_dia, t."pedidoB2bVentanaAperturaHora" ap_hora, t."pedidoB2bVentanaCierreDia" ci_dia, t."pedidoB2bVentanaCierreHora" ci_hora,
  (select count(*) from orders o where o."tenantId"=t.id) pedidos_b2c,
  (select count(*) from pedidos_b2b p where p."tenantId"=t.id) pedidos_b2b,
  (select count(*) from "products" pr where pr."tenantId"=t.id and pr.disponible) prod_disp
  from tenants t where t."tipoStorefront"='RETAIL_B2B' order by t.slug`);
await q('codigos', `select t.slug, count(*) total,
  count(*) filter (where not c.activo) inactivos,
  count(*) filter (where c.activo and c."fechaLimite" is not null and c."fechaLimite" < current_date) vencidos,
  count(*) filter (where c.activo and c."usosMaximos" is not null and (select count(*) from pedidos_b2b p where p."codigoDescuentoId"=c.id) >= c."usosMaximos") agotados,
  count(*) filter (where c.activo and (c."fechaLimite" is null or c."fechaLimite" >= current_date) and (c."usosMaximos" is null or (select count(*) from pedidos_b2b p where p."codigoDescuentoId"=c.id) < c."usosMaximos")) vigentes,
  count(*) filter (where c.codigo like 'SEED0C\\_%') sembrados
  from pedido_b2b_codigos_descuento c join tenants t on t.id=c."tenantId" group by t.slug order by t.slug`);
await q('clientes_b2b', `select t.slug, count(*) clientes_b2b, count(*) filter (where c.telefono like '00000000%') sembrados
  from clientes c join tenants t on t.id=c."tenantId" where c.canal='B2B' group by t.slug order by t.slug`);
await q('variantes_por_tenant', `select t.slug, p."modoCobro" modo, p.estado, p."estadoPago" pago, p.cancelado, p."requiereFactura" factura,
  (p."codigoDescuentoTexto" is not null) con_codigo, (p."negocioNombre" like '%[SEED-0c:%') sembrado, count(*) n
  from pedidos_b2b p join tenants t on t.id=p."tenantId" group by 1,2,3,4,5,6,7,8 order by 1,2,3,4,5,6,7,8`);
await q('estructura', `select t.slug,
  count(*) pedidos,
  count(*) filter (where (select count(*) from pedido_b2b_items i where i."pedidoB2bId"=p.id) = 1) un_solo_producto,
  count(*) filter (where (select count(*) from pedido_b2b_items i where i."pedidoB2bId"=p.id) >= 2) varios_productos,
  count(*) filter (where (select count(distinct d.dia) from pedido_b2b_items_dia d join pedido_b2b_items i on i.id=d."pedidoB2bItemId" where i."pedidoB2bId"=p.id) <= 3) reparto_en_pocos_dias,
  count(*) filter (where (select count(distinct d.dia) from pedido_b2b_items_dia d join pedido_b2b_items i on i.id=d."pedidoB2bItemId" where i."pedidoB2bId"=p.id) >= 6) reparto_en_muchos_dias,
  count(*) filter (where p."totalPiezas" < p."minimoPiezasAplicado") bajo_minimo,
  count(*) filter (where p."semanaInicio" < p."createdAt"::date) semana_anterior_a_creacion,
  count(*) filter (where extract(dow from p."semanaInicio") <> 1) semana_no_lunes
  from pedidos_b2b p join tenants t on t.id=p."tenantId" group by t.slug order by t.slug`);
// Pedidos NO sembrados (los originales): folio, estado y total — para comprobar que no cambian.
await q('originales', `select t.slug, count(*) n, sum(p.total) suma_total,
  string_agg(p.folio || ':' || p.total::text, ',' order by p.folio::int) folio_total
  from pedidos_b2b p join tenants t on t.id=p."tenantId" where p."negocioNombre" not like '%[SEED-0c:%' group by t.slug order by t.slug`);
await q('sembrados_folios', `select t.slug, p."negocioNombre" like '%[SEED-0c:%' as es_semilla, substring(p."negocioNombre" from '\\[SEED-0c:([a-z0-9]+)\\]') variante,
  p.folio, p."modoCobro" modo, p.estado, p."estadoPago" pago, p.cancelado, p."requiereFactura" factura, p."codigoDescuentoTexto" codigo, p."totalPiezas" piezas, p.total
  from pedidos_b2b p join tenants t on t.id=p."tenantId" where p."negocioNombre" like '%[SEED-0c:%' order by t.slug, variante`);
await c.query('ROLLBACK');
await c.end();
console.log(JSON.stringify(out, null, 1));
