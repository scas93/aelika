#!/usr/bin/env node
// Runner de verificar.sql (Etapa 1). SOLO LECTURA: todo corre dentro de BEGIN READ ONLY.
//
// Uso local:      DATABASE_URL=postgresql://... node scripts/etapa1/verificar-runner.mjs
// Línea base:     ... --solo-linea-base antes.json          (ANTES de migrar: conteo y suma de total por tenant;
//                                                            no toca detalles_b2c, que aún no existe)
//                 ... --comparar antes.json                (DESPUÉS: verificar.sql completo + compara contra la línea base)
//                 ... --guardar-linea-base f.json          (DESPUÉS: además guarda la línea base actual)
// En Railway:     ver scripts/etapa1/README.md (railway ssh, sin psql, sin proxy público).
//
// El SQL se lee de verificar.sql junto a este archivo, o de VERIFICAR_SQL_B64 (base64) si se ejecuta
// desde stdin/tmp dentro del contenedor. `pg` se resuelve desde el cwd (node_modules del backend).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(process.cwd(), 'noop.js'));
const { Client } = require('pg');

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

function leerSql() {
  if (process.env.VERIFICAR_SQL_B64) return Buffer.from(process.env.VERIFICAR_SQL_B64, 'base64').toString('utf8');
  const aqui = path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(aqui, 'verificar.sql'), 'utf8');
}

function bloques(sql) {
  const out = [];
  let actual = null;
  for (const linea of sql.split('\n')) {
    const m = linea.match(/^-- @([a-z_]+):\s*(.*)$/);
    if (m) {
      if (actual) out.push(actual);
      actual = { nombre: m[1], descripcion: m[2], sql: '' };
    } else if (actual && !linea.startsWith('--')) {
      actual.sql += linea + '\n';
    }
  }
  if (actual) out.push(actual);
  return out.map((b) => ({ ...b, sql: b.sql.trim().replace(/;\s*$/, '') }));
}

const num = (v) => Number(v);
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

if (opt('--solo-linea-base')) {
  try {
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(
      'SELECT "tenantId", count(*) AS ordenes, sum("total") AS suma_total FROM "orders" GROUP BY "tenantId" ORDER BY "tenantId"',
    );
    await client.query('ROLLBACK');
    const base = { por_tenant: rows.map((r) => ({ tenantId: r.tenantId, ordenes: Number(r.ordenes), suma_total: String(r.suma_total) })) };
    fs.writeFileSync(opt('--solo-linea-base'), JSON.stringify(base, null, 2));
    console.log('Línea base (antes de migrar):');
    console.table(base.por_tenant);
  } finally {
    await client.end();
  }
  process.exit(0);
}
let fallos = 0;
const marca = (ok, msg) => {
  if (!ok) fallos++;
  console.log(`${ok ? '  OK   ' : '  FALLA'}  ${msg}`);
};

try {
  await client.query('BEGIN READ ONLY');
  const resultados = {};
  for (const b of bloques(leerSql())) {
    resultados[b.nombre] = (await client.query(b.sql)).rows;
    console.log(`\n## ${b.nombre} — ${b.descripcion}`);
    console.table(resultados[b.nombre]);
  }
  await client.query('ROLLBACK');

  // Línea base: solo lo que no cambia con la migración.
  const actual = { por_tenant: resultados.suma_total_por_tenant.map((r) => ({ tenantId: r.tenantId, ordenes: num(r.ordenes), suma_total: String(r.suma_total) })) };
  if (opt('--guardar-linea-base')) {
    fs.writeFileSync(opt('--guardar-linea-base'), JSON.stringify(actual, null, 2));
    console.log(`\nLínea base guardada en ${opt('--guardar-linea-base')}`);
  }

  console.log('\n## Veredicto');
  const c = resultados.conteos[0];
  marca(num(c.orders_con_detalle) === num(c.orders) - resultados.ordenes_sin_detalle.length, `orders(${c.orders}) = con detalle(${c.orders_con_detalle}) + sin detalle(${resultados.ordenes_sin_detalle.length})`);
  const sd = resultados.sin_detalle_resumen[0];
  marca(num(sd.sin_detalle_antes_del_corte) === 0, `órdenes sin detalle ANTES del corte = ${sd.sin_detalle_antes_del_corte} (debe ser 0)`);
  console.log(`  INFO   órdenes sin detalle DESPUÉS del corte (traslape) = ${sd.sin_detalle_despues_del_corte}`);
  marca(num(resultados.detalles_huerfanos[0].detalles_huerfanos) === 0, 'detalles huérfanos = 0');
  marca(num(resultados.detalles_duplicados[0].ordenes_con_mas_de_un_detalle) === 0, 'órdenes con más de un detalle = 0');
  const cd = resultados.campos_distintos[0];
  const distintos = Object.entries(cd).filter(([k, v]) => k !== 'filas_comparadas' && num(v) > 0);
  marca(distintos.length === 0, `campos del detalle iguales a la columna vieja en ${cd.filas_comparadas} filas${distintos.length ? ' — difieren: ' + distintos.map(([k, v]) => `${k}=${v}`).join(', ') : ''}`);
  marca(resultados.conteo_por_tipo.every((r) => r.tipo === 'B2C'), `todas las órdenes con tipo B2C (${resultados.conteo_por_tipo.map((r) => `${r.tipo}:${r.ordenes}`).join(', ')})`);

  if (opt('--comparar')) {
    const antes = JSON.parse(fs.readFileSync(opt('--comparar'), 'utf8'));
    const ahora = new Map(actual.por_tenant.map((r) => [r.tenantId, r]));
    for (const a of antes.por_tenant) {
      const d = ahora.get(a.tenantId);
      // Las órdenes creadas después de la línea base la aumentan: igualdad solo si no hubo pedidos nuevos.
      marca(!!d && d.ordenes >= a.ordenes, `tenant ${a.tenantId}: órdenes ${a.ordenes} → ${d?.ordenes}; suma total ${a.suma_total} → ${d?.suma_total}${d && d.ordenes === a.ordenes ? (d.suma_total === a.suma_total ? ' (idéntica)' : ' (DIFIERE)') : ' (hay pedidos nuevos)'}`);
      if (d && d.ordenes === a.ordenes) marca(d.suma_total === a.suma_total, `tenant ${a.tenantId}: suma de total sin cambios`);
    }
  }
  console.log(fallos === 0 ? '\nRESULTADO: TODO CORRECTO' : `\nRESULTADO: ${fallos} VERIFICACIÓN(ES) FALLARON`);
} finally {
  await client.end();
}
process.exit(fallos === 0 ? 0 : 1);
