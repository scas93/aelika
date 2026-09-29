import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'dotenv';

const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Guarda de la suite de caracterización: la suite BORRA todas las tablas
 * entre tests, así que solo puede correr contra una base dedicada y local.
 * Nunca la base de desarrollo, staging ni producción.
 */
export function assertTestDatabaseUrl(rawUrl: string | undefined): string {
  if (!rawUrl) {
    throw new Error('[characterization] No hay URL de base de pruebas (TEST_DATABASE_URL).');
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('[characterization] La URL de la base de pruebas no es válida.');
  }
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `[characterization] Me niego a correr: la base "${dbName}" no termina en "_test". ` +
        'Esta suite borra todas las tablas entre tests.',
    );
  }
  if (!HOSTS_LOCALES.has(url.hostname)) {
    throw new Error(
      `[characterization] Me niego a correr: el host "${url.hostname}" no es local. ` +
        'Staging y producción nunca son base de tests.',
    );
  }
  return rawUrl;
}

/**
 * TEST_DATABASE_URL si existe; si no, se deriva de la DATABASE_URL de
 * backend/.env cambiando solo el nombre de la base a "<nombre>_test".
 */
export function resolveTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) {
    return assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  }
  const envPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    const dev = parse(fs.readFileSync(envPath)).DATABASE_URL;
    if (dev) {
      const url = new URL(dev);
      const dbName = url.pathname.replace(/^\//, '');
      url.pathname = `/${dbName.endsWith('_test') ? dbName : `${dbName}_test`}`;
      return assertTestDatabaseUrl(url.toString());
    }
  }
  throw new Error('[characterization] Define TEST_DATABASE_URL (base local que termine en "_test").');
}
