import request from 'supertest';
import { expectError } from './exacto';
import { usarSuite } from './helpers';
import { apiRol } from './b2b-helpers';

// Gerente = Dueño en todo el panel salvo Adopción, Notificaciones y Ajustes (en Ajustes el Gerente solo tiene Información del
// negocio y Equipo, con límites; ver gerente-ajustes.char-spec.ts). El Operador no cambia.
// Se prueba en un tenant B2C y en uno B2B; las rutas de Ajustes no dependen del tipo de storefront.
const MSG = 'No tienes permiso para realizar esta acción';

describe.each([['RETAIL_B2C'], ['RETAIL_B2B']] as const)('Rol Gerente · secciones exclusivas del Dueño (%s)', (tipo) => {
  const s = usarSuite({ seed: { tipoStorefront: tipo } });
  const gerente = () => apiRol(s.h, s.base, 'GERENTE');
  const dueno = () => apiRol(s.h, s.base, 'DUENO');

  it('Notificaciones: /reglas/* 403 para Gerente y Operador, 200 para Dueño', async () => {
    await dueno().get('/reglas').expect(200);
    for (const rol of ['GERENTE', 'OPERADOR'] as const) {
      expectError(await apiRol(s.h, s.base, rol).get('/reglas'), 403, MSG);
      expectError(await apiRol(s.h, s.base, rol).get('/reglas/catalogo-variables'), 403, MSG);
      expectError(await apiRol(s.h, s.base, rol).post('/reglas', { nombre: 'x' }), 403, MSG);
      expectError(
        await apiRol(s.h, s.base, rol).post('/reglas/00000000-0000-4000-8000-000000000000/disparar', {}),
        403,
        MSG,
      );
    }
  });

  it('Ajustes: /tenant/me, /notificaciones/*, /puntos-envio (escritura) y /aelika-scan 403 para Gerente', async () => {
    expectError(await gerente().get('/tenant/me'), 403, MSG);
    expectError(await gerente().patch('/tenant/me').send({ mensajeBienvenida: 'hola' }), 403, MSG);
    expectError(await gerente().post('/tenant/me/regenerate-bot-key', {}), 403, MSG);
    expectError(await gerente().post('/tenant/me/stripe-account', {}), 403, MSG);
    expectError(await gerente().get('/notificaciones/canales'), 403, MSG);
    expectError(await gerente().get('/notificaciones/eventos'), 403, MSG);
    expectError(await gerente().post('/puntos-envio', { nombre: 'Zona', direccion: 'Calle 1' }), 403, MSG);
    await dueno().get('/tenant/me').expect(200);
    await dueno().get('/users').expect(200);
  });

  it('Adopción: 403 para Gerente (la restricción no cambió)', async () => {
    await gerente().get('/adopcion/clientes').expect(403);
    await gerente().get('/adopcion/interno').expect(403);
  });

  it('lo demás sigue abierto al Gerente: lectura de puntos de envío, códigos y clientes', async () => {
    await gerente().get('/puntos-envio').expect(200);
    await gerente().get('/clientes').expect(200);
    await gerente().get('/products').expect(200);
    await gerente().post('/categories', { nombre: 'Nueva' }).expect(201);
  });

  it('GET /auth/me: los 3 roles reciben nombre y ubicación del negocio (sin llaves ni configuración sensible)', async () => {
    for (const rol of ['OPERADOR', 'GERENTE', 'DUENO'] as const) {
      const me = (await apiRol(s.h, s.base, rol).get('/auth/me').expect(200)).body;
      expect(Object.keys(me.tenant).sort()).toStrictEqual(
        ['modulosDesactivados', 'nombre', 'slug', 'tipoStorefront', 'ubicacion'].sort(),
      );
    }
    expectError(await request(s.h.app.getHttpServer()).get('/auth/me'), 401, 'Unauthorized');
  });
});
