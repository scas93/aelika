#!/usr/bin/env node
// Carga un volcado NDJSON (volcar-staging-saneado.mjs) en una base LOCAL de pruebas de la Etapa 1.
// Guardas: el host debe ser local y el nombre de la base debe empezar con "etapa1_" — nunca la base
// de desarrollo, la _test, staging ni producción. La base ya debe tener el esquema PREVIO a la
// migración de la Etapa 1 (44 migraciones, ver scripts/etapa1/README.md).
//
// Uso: DATABASE_URL=postgresql://.../etapa1_staging node scripts/etapa1/cargar-volcado.mjs < volcado.ndjson
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(path.join(process.cwd(), 'noop.js'));
const { Client } = require('pg');

const url = new URL(process.env.DATABASE_URL ?? 'postgresql://x@invalido/x');
const db = decodeURIComponent(url.pathname.slice(1));
if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || !db.startsWith('etapa1_')) {
  console.error(`Me niego: la base "${db}" en "${url.hostname}" no es una base local "etapa1_*".`);
  process.exit(2);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
// Se lee TODO el stdin antes de conectar: un readline creado antes de los await pierde líneas.
const lineas = fs.readFileSync(0, 'utf8').split('\n');
try {
  await client.query('BEGIN');
  for (const linea of lineas) {
    if (!linea.trim()) continue;
    const { tabla, filas } = JSON.parse(linea);
    for (const fila of filas) {
      const cols = Object.keys(fila);
      const vals = cols.map((c) => {
        const v = fila[c];
        return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
      });
      await client.query(
        `INSERT INTO "${tabla}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
        vals,
      );
    }
    console.log(`cargado ${tabla}: ${filas.length} filas`);
  }
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  await client.end();
}
