import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { Client } from 'pg';
import { resolveTestDatabaseUrl } from './db-guard';

/**
 * Corre una vez antes de toda la suite: verifica la guarda, crea la base de
 * pruebas si no existe y aplica las migraciones del repo (migrate deploy es
 * idempotente).
 */
export default async function globalSetup() {
  const testUrl = resolveTestDatabaseUrl();
  const url = new URL(testUrl);
  const dbName = url.pathname.replace(/^\//, '');

  const admin = new URL(testUrl);
  admin.pathname = '/postgres';
  admin.search = '';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const existe = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (existe.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
    }
  } finally {
    await client.end();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
}
