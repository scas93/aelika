import request from 'supertest';
import { expectError } from './exacto';
import { usarSuite } from './helpers';
import { apiRol } from './b2b-helpers';

// Notificaciones (reglas) en un tenant RETAIL_B2C: se queda como siempre, solo Dueño. (En B2B el Gerente también: transversal-reglas.)
describe('B2C · reglas de notificación: solo Dueño', () => {
  const s = usarSuite({ reglasReales: true });
  const msg = 'No tienes permiso para realizar esta acción';

  it('Gerente y Operador 403 en lectura y escritura; Dueño 200; sin token 401', async () => {
    await apiRol(s.h, s.base, 'DUENO').get('/reglas').expect(200);
    for (const rol of ['GERENTE', 'OPERADOR'] as const) {
      expectError(await apiRol(s.h, s.base, rol).get('/reglas'), 403, msg);
      expectError(await apiRol(s.h, s.base, rol).get('/reglas/catalogo-variables'), 403, msg);
      expectError(await apiRol(s.h, s.base, rol).post('/reglas', { nombre: 'x' }), 403, msg);
    }
    expectError(await request(s.h.app.getHttpServer()).get('/reglas'), 401, 'Unauthorized');
  });
});
