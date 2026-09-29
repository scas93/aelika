import { assertTestDatabaseUrl } from './db-guard';

describe('guarda de base de pruebas', () => {
  it('acepta una base local que termina en _test', () => {
    expect(assertTestDatabaseUrl('postgresql://u:p@localhost:5432/aelika_test?schema=public')).toBeTruthy();
  });

  it('rechaza la base de desarrollo (sin sufijo _test)', () => {
    expect(() => assertTestDatabaseUrl('postgresql://u:p@localhost:5432/aelika?schema=public')).toThrow(/_test/);
  });

  it('rechaza un host remoto aunque el nombre termine en _test (staging/producción)', () => {
    expect(() => assertTestDatabaseUrl('postgresql://u:p@postgres.railway.internal:5432/railway_test')).toThrow(/no es local/);
  });

  it('rechaza si no hay URL', () => {
    expect(() => assertTestDatabaseUrl(undefined)).toThrow();
  });
});
