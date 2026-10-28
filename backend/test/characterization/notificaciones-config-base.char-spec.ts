import request from 'supertest';
import { tokenFor } from './auth';
import { seedBase } from './db';
import { auth, usarSuite } from './helpers';
import { apiRol } from './b2b-helpers';
import { expectError } from './exacto';

// Contrato ACTUAL (antes del Cambio B) de /notificaciones/canales y /notificaciones/eventos. Congela solo lo que el
// Cambio B no debe romper; lo que cambia a propósito está marcado «CAMBIA en el Cambio B» y se actualiza en su commit.
const MSG_403 = 'No tienes permiso para realizar esta acción';
const CLAVES_CANAL = ['activo', 'conectado', 'config', 'createdAt', 'id', 'tenantId', 'tipo', 'updatedAt'];
const CLAVES_EVENTO = ['activo', 'audiencia', 'canalConfigId', 'createdAt', 'evento', 'id', 'tenantId', 'updatedAt'];
const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

describe('Notificaciones · canales y eventos (contrato base)', () => {
  const s = usarSuite();
  const dueno = () => apiRol(s.h, s.base, 'DUENO');

  const crearCorreo = async (config: Record<string, unknown> = { nombreRemitente: 'Café', correoDestino: 'a@b.com' }) =>
    (await dueno().post('/notificaciones/canales', { tipo: 'CORREO', config }).expect(201)).body;

  describe('canales', () => {
    it('GET vacío; POST crea con activo=true, conectado=false y la forma exacta; GET lo lista', async () => {
      expect((await dueno().get('/notificaciones/canales').expect(200)).body).toStrictEqual([]);
      const creado = await crearCorreo();
      expect(Object.keys(creado).sort()).toStrictEqual(CLAVES_CANAL);
      expect(creado).toMatchObject({
        tenantId: s.base.tenant.id,
        tipo: 'CORREO',
        activo: true,
        conectado: false,
        config: { nombreRemitente: 'Café', correoDestino: 'a@b.com' },
      });
      const lista = (await dueno().get('/notificaciones/canales').expect(200)).body;
      expect(lista.map((c: { id: string }) => c.id)).toStrictEqual([creado.id]);
    });

    it('el config de Correo y Telegram no se valida por forma (cualquier objeto pasa)', async () => {
      await dueno().post('/notificaciones/canales', { tipo: 'CORREO', config: { lo: 'que sea' } }).expect(201);
      await dueno().post('/notificaciones/canales', { tipo: 'TELEGRAM', config: {} }).expect(201);
    });

    it('rechaza tipo inválido y config que no es objeto (400)', async () => {
      await dueno().post('/notificaciones/canales', { tipo: 'FAX', config: {} }).expect(400);
      await dueno().post('/notificaciones/canales', { tipo: 'CORREO', config: 'x' }).expect(400);
      await dueno().post('/notificaciones/canales', { tipo: 'CORREO' }).expect(400);
    });

    it('PATCH cambia activo/config; id inexistente 404; DELETE borra (204/200) y 404 si ya no existe', async () => {
      const c = await crearCorreo();
      const act = (await dueno().patch(`/notificaciones/canales/${c.id}`).send({ activo: false }).expect(200)).body;
      expect(act.activo).toBe(false);
      const cfg = (await dueno().patch(`/notificaciones/canales/${c.id}`).send({ config: { nombreRemitente: 'Otro' } }).expect(200)).body;
      expect(cfg.config).toStrictEqual({ nombreRemitente: 'Otro' });
      expect((await dueno().patch(`/notificaciones/canales/${ID_INEXISTENTE}`).send({ activo: false })).status).toBe(404);
      await dueno().delete(`/notificaciones/canales/${c.id}`).expect(200);
      expect((await dueno().delete(`/notificaciones/canales/${c.id}`)).status).toBe(404);
    });

    // CAMBIA en el Cambio B: hoy el duplicado revienta como 500 (P2002 sin capturar); pasa a 409.
    it('un segundo canal del mismo tipo para el negocio hoy es 500 (CAMBIA en el Cambio B → 409)', async () => {
      await crearCorreo();
      expect((await dueno().post('/notificaciones/canales', { tipo: 'CORREO', config: {} })).status).toBe(500);
    });

    it('aislamiento: otro negocio no ve ni toca los canales', async () => {
      const c = await crearCorreo();
      const otro = await seedBase(s.h.prisma, { slug: 'otro-negocio' });
      const apiOtro = auth(s.h, tokenFor(s.h.jwt, otro.dueno, otro.tenant.id, 'DUENO'));
      expect((await apiOtro.get('/notificaciones/canales').expect(200)).body).toStrictEqual([]);
      expect((await apiOtro.patch(`/notificaciones/canales/${c.id}`).send({ activo: false })).status).toBe(404);
      expect((await apiOtro.delete(`/notificaciones/canales/${c.id}`)).status).toBe(404);
      // El mismo tipo en el otro negocio sí se puede crear (unique por tenant + tipo).
      await apiOtro.post('/notificaciones/canales', { tipo: 'CORREO', config: {} }).expect(201);
    });
  });

  describe('eventos', () => {
    it('POST crea con activo=true; GET lista con el canal incluido; duplicado exacto 409', async () => {
      const c = await crearCorreo();
      const body = { evento: 'PEDIDO_RECIBIDO', audiencia: 'NEGOCIO', canalConfigId: c.id };
      const ev = (await dueno().post('/notificaciones/eventos', body).expect(201)).body;
      expect(Object.keys(ev).sort()).toStrictEqual(CLAVES_EVENTO);
      expect(ev).toMatchObject({ evento: 'PEDIDO_RECIBIDO', audiencia: 'NEGOCIO', activo: true, canalConfigId: c.id });
      const lista = (await dueno().get('/notificaciones/eventos').expect(200)).body;
      expect(lista).toHaveLength(1);
      expect(Object.keys(lista[0]).sort()).toStrictEqual([...CLAVES_EVENTO, 'canalConfig'].sort());
      expect(lista[0].canalConfig.id).toBe(c.id);
      expectError(await dueno().post('/notificaciones/eventos', body), 409, 'Ya existe esta combinación de evento, audiencia y canal');
    });

    it('canal inexistente o de otro negocio → 404; evento/audiencia inválidos → 400', async () => {
      expectError(
        await dueno().post('/notificaciones/eventos', { evento: 'PEDIDO_RECIBIDO', audiencia: 'NEGOCIO', canalConfigId: ID_INEXISTENTE }),
        404,
        'Configuración de canal no encontrada',
      );
      const otro = await seedBase(s.h.prisma, { slug: 'otro-negocio' });
      const apiOtro = auth(s.h, tokenFor(s.h.jwt, otro.dueno, otro.tenant.id, 'DUENO'));
      const ajeno = (await apiOtro.post('/notificaciones/canales', { tipo: 'CORREO', config: {} }).expect(201)).body;
      expect(
        (await dueno().post('/notificaciones/eventos', { evento: 'PEDIDO_RECIBIDO', audiencia: 'NEGOCIO', canalConfigId: ajeno.id })).status,
      ).toBe(404);
      const c = await crearCorreo();
      await dueno().post('/notificaciones/eventos', { evento: 'NADA', audiencia: 'NEGOCIO', canalConfigId: c.id }).expect(400);
      await dueno().post('/notificaciones/eventos', { evento: 'PEDIDO_RECIBIDO', audiencia: 'TODOS', canalConfigId: c.id }).expect(400);
    });

    it('PATCH activo y canalConfigId; DELETE; y borrar el canal borra en cascada sus eventos', async () => {
      const c1 = await crearCorreo();
      const c2 = (await dueno().post('/notificaciones/canales', { tipo: 'TELEGRAM', config: { chatId: '1' } }).expect(201)).body;
      const ev = (await dueno().post('/notificaciones/eventos', { evento: 'PAGO_CONFIRMADO', audiencia: 'NEGOCIO', canalConfigId: c1.id }).expect(201)).body;
      expect((await dueno().patch(`/notificaciones/eventos/${ev.id}`).send({ activo: false }).expect(200)).body.activo).toBe(false);
      expect((await dueno().patch(`/notificaciones/eventos/${ev.id}`).send({ canalConfigId: c2.id }).expect(200)).body.canalConfigId).toBe(c2.id);
      expect((await dueno().patch(`/notificaciones/eventos/${ID_INEXISTENTE}`).send({ activo: true })).status).toBe(404);
      await dueno().delete(`/notificaciones/canales/${c2.id}`).expect(200);
      expect((await dueno().get('/notificaciones/eventos').expect(200)).body).toStrictEqual([]);
      expect((await dueno().delete(`/notificaciones/eventos/${ev.id}`)).status).toBe(404);
    });

    // CAMBIA en el Cambio B: en mayoreo ya no se aceptan eventos de menudeo (hoy sí, el backend no mira el tipo de negocio).
    it.each(['RETAIL_B2B', 'HOTEL'] as const)('hoy un negocio %s puede crear canales y eventos de menudeo', async (tipoStorefront) => {
      const suiteB = await seedBase(s.h.prisma, { slug: `neg-${tipoStorefront.toLowerCase()}`, tipoStorefront });
      const api = auth(s.h, tokenFor(s.h.jwt, suiteB.dueno, suiteB.tenant.id, 'DUENO'));
      const c = (await api.post('/notificaciones/canales', { tipo: 'CORREO', config: {} }).expect(201)).body;
      await api.post('/notificaciones/eventos', { evento: 'PEDIDO_RECIBIDO', audiencia: 'NEGOCIO', canalConfigId: c.id }).expect(201);
    });
  });

  describe('permisos', () => {
    it('Gerente y Operador 403 en todas las rutas; sin sesión 401', async () => {
      const c = await crearCorreo();
      for (const rol of ['GERENTE', 'OPERADOR'] as const) {
        const api = apiRol(s.h, s.base, rol);
        expectError(await api.get('/notificaciones/canales'), 403, MSG_403);
        expectError(await api.post('/notificaciones/canales', { tipo: 'CORREO', config: {} }), 403, MSG_403);
        expectError(await api.patch(`/notificaciones/canales/${c.id}`).send({ activo: false }), 403, MSG_403);
        expectError(await api.delete(`/notificaciones/canales/${c.id}`), 403, MSG_403);
        expectError(await api.get('/notificaciones/eventos'), 403, MSG_403);
        expectError(
          await api.post('/notificaciones/eventos', { evento: 'PEDIDO_RECIBIDO', audiencia: 'NEGOCIO', canalConfigId: c.id }),
          403,
          MSG_403,
        );
      }
      expect((await request(s.h.app.getHttpServer()).get('/notificaciones/canales')).status).toBe(401);
    });
  });
});
