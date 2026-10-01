// Utilidades compartidas por sembrar-b2b-staging.mjs y auditar-b2b-staging.mjs.
// Pensado para correr dentro del contenedor de Railway (railway ssh) o contra una base LOCAL de prueba.
import path from 'node:path';
import { createRequire } from 'node:module';

// `pg` se resuelve desde el cwd (node_modules del backend / /app en el contenedor).
const require = createRequire(path.join(process.cwd(), 'noop.js'));
export const { Client } = require('pg');

export const STAGING_PROJECT_ID = 'e2686010-d4f1-4431-91c2-89c880dbd243'; // merry-compassion
export const PROD_PROJECT_ID = 'f0552b14-0b13-4719-b2aa-c887de82f7d6'; // outstanding-compassion (nunca)

/** Guarda de proyecto: por ID (no por nombre de entorno: en staging el entorno se llama "production").
 *  Fuera de Railway solo se permite con SEED_ENTORNO_LOCAL=1 Y una DATABASE_URL en localhost. */
export function guardaProyecto() {
  const id = process.env.RAILWAY_PROJECT_ID;
  if (id === STAGING_PROJECT_ID) {
    console.error(`[guarda] OK: proyecto staging (${id.slice(0, 8)}…)`);
    return 'staging';
  }
  const local = process.env.SEED_ENTORNO_LOCAL === '1' && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
  if (!id && local) {
    console.error('[guarda] OK: entorno LOCAL de prueba (SEED_ENTORNO_LOCAL=1, base en localhost)');
    return 'local';
  }
  console.error(`[guarda] ABORTO: RAILWAY_PROJECT_ID=${id ? id.slice(0, 8) + '…' : '(vacío)'} no es staging (merry-compassion). No se escribió ni leyó nada.`);
  process.exit(2);
}

export const trunc = (id) => (id ? String(id).slice(0, 8) : id);
