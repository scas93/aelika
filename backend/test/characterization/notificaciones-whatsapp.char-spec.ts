import { tokenFor } from './auth';
import { seedBase } from './db';
import { auth, usarSuite } from './helpers';
import { apiRol } from './b2b-helpers';
import { expectError } from './exacto';

// Cambio B · avisos internos por WhatsApp: SOLO configuración (canal WHATSAPP + evento PEDIDO_MODIFICADO_CLIENTE).
const MSG_403 = 'No tienes permiso para realizar esta acción';
const EVENTO = 'PEDIDO_MODIFICADO_CLIENTE';
const ana = { nombre: 'Ana', telefono: '55 1234 5678' };
const luis = { nombre: 'Luis', telefono: '+1 818 814 0000' };

describe.each([['RETAIL_B2B']] as const)('Notificaciones WhatsApp · mayoreo (%s)', (tipoStorefront) => {
  const s = usarSuite({ seed: { tipoStorefront } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  const conWebhook = () => s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { botWebhookUrl: 'https://bot.example/hook' } });
  const crear = (config: unknown, extra: Record<string, unknown> = {}) =>
    dueno().post('/notificaciones/canales', { tipo: 'WHATSAPP', config, ...extra });

  describe('canal', () => {
    it('alta válida: normaliza teléfonos, asigna id a cada destinatario y deja el canal activo', async () => {
      await conWebhook();
      const c = (await crear({ destinatarios: [ana, luis] }).expect(201)).body;
      expect(c).toMatchObject({ tipo: 'WHATSAPP', activo: true, conectado: false });
      expect(Object.keys(c.config)).toStrictEqual(['destinatarios']);
      expect(c.config.destinatarios).toMatchObject([
        { nombre: 'Ana', telefono: '5512345678' },
        { nombre: 'Luis', telefono: '+18188140000' },
      ]);
      for (const d of c.config.destinatarios) expect(d.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('el config se valida en alta y edición (límites, nombres, teléfonos, repetidos)', async () => {
      await conWebhook();
      const diez = Array.from({ length: 10 }, (_, i) => ({ nombre: `P${i}`, telefono: `551234567${i}` }));
      await crear({ destinatarios: diez }).expect(201);
      const c = (await dueno().get('/notificaciones/canales').expect(200)).body[0];
      const patch = (config: unknown) => dueno().patch(`/notificaciones/canales/${c.id}`).send({ config });
      expectError(await patch({ destinatarios: [...diez, { nombre: 'Extra', telefono: '5599999999' }] }), 400, 'Máximo 10 destinatarios');
      expect((await patch({ destinatarios: [{ nombre: '', telefono: '5512345678' }] })).status).toBe(400);
      expect((await patch({ destinatarios: [{ nombre: 'x'.repeat(61), telefono: '5512345678' }] })).status).toBe(400);
      expect((await patch({ destinatarios: [{ nombre: 'A', telefono: '12345' }] })).status).toBe(400);
      expect((await patch({ destinatarios: [{ nombre: 'A', telefono: '55 1234 5678' }, { nombre: 'B', telefono: '+52 5512345678' }] })).status).toBe(400);
      expect((await patch({})).status).toBe(400);
      expect((await patch({ destinatarios: [ana] }).expect(200)).body.config.destinatarios).toHaveLength(1);
    });

    it('editar conserva la id de los destinatarios que se mandan con su id', async () => {
      await conWebhook();
      const c = (await crear({ destinatarios: [ana, luis] }).expect(201)).body;
      const [a, l] = c.config.destinatarios;
      const e = (await dueno().patch(`/notificaciones/canales/${c.id}`).send({ config: { destinatarios: [{ ...l, nombre: 'Luis M.' }, a] } }).expect(200)).body;
      expect(e.config.destinatarios.map((d: { id: string }) => d.id)).toStrictEqual([l.id, a.id]);
      expect(e.config.destinatarios[0].nombre).toBe('Luis M.');
    });

    it('activo exige al menos 1 destinatario: alta con 0 → 409 (inactivo sí se permite); quitar el último con el canal activo → 409', async () => {
      await conWebhook();
      expect((await crear({ destinatarios: [] })).status).toBe(409);
      const inactivo = (await crear({ destinatarios: [] }, { activo: false }).expect(201)).body;
      expect(inactivo.activo).toBe(false);
      expectError(
        await dueno().patch(`/notificaciones/canales/${inactivo.id}`).send({ activo: true }),
        409,
        'Un canal de WhatsApp activo necesita al menos un destinatario. Desactívalo primero o agrega uno',
      );
      await dueno().patch(`/notificaciones/canales/${inactivo.id}`).send({ config: { destinatarios: [ana] }, activo: true }).expect(200);
      expect((await dueno().patch(`/notificaciones/canales/${inactivo.id}`).send({ config: { destinatarios: [] } })).status).toBe(409);
      // Desactivar primero y luego vaciar sí se puede (también en un solo PATCH).
      await dueno().patch(`/notificaciones/canales/${inactivo.id}`).send({ activo: false, config: { destinatarios: [] } }).expect(200);
    });

    it('sin URL de webhook en Conexión WhatsApp no se puede activar (alta o PATCH); inactivo sí; con URL sí', async () => {
      const msg = 'Configura primero la URL del webhook en Conexión WhatsApp para poder activar este canal';
      expectError(await crear({ destinatarios: [ana] }), 409, msg);
      const c = (await crear({ destinatarios: [ana] }, { activo: false }).expect(201)).body;
      expectError(await dueno().patch(`/notificaciones/canales/${c.id}`).send({ activo: true }), 409, msg);
      await conWebhook();
      expect((await dueno().patch(`/notificaciones/canales/${c.id}`).send({ activo: true }).expect(200)).body.activo).toBe(true);
    });

    it('el secreto del webhook no es requisito, y una URL en blanco no cuenta', async () => {
      await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { botWebhookUrl: '   ' } });
      expect((await crear({ destinatarios: [ana] })).status).toBe(409);
      await conWebhook(); // sin botWebhookSecret
      await crear({ destinatarios: [ana] }).expect(201);
    });

    it('un segundo canal WhatsApp → 409; editar destinatarios de uno ya activo no vuelve a exigir el webhook', async () => {
      await conWebhook();
      const c = (await crear({ destinatarios: [ana] }).expect(201)).body;
      expectError(await crear({ destinatarios: [ana] }), 409, 'Ya existe un canal de este tipo para tu negocio');
      await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { botWebhookUrl: null } });
      await dueno().patch(`/notificaciones/canales/${c.id}`).send({ config: { destinatarios: [ana, luis] } }).expect(200);
    });

    it('mayoreo no puede crear Telegram ni Correo (403), ni editar filas viejas; GET solo muestra WhatsApp; DELETE de una fila vieja sí', async () => {
      await conWebhook();
      expect((await dueno().post('/notificaciones/canales', { tipo: 'CORREO', config: {} })).status).toBe(403);
      expect((await dueno().post('/notificaciones/canales', { tipo: 'TELEGRAM', config: {} })).status).toBe(403);
      const vieja = await s.h.prisma.notificacionCanalConfig.create({ data: { tenantId: s.base.tenant.id, tipo: 'CORREO', config: {} } });
      const wa = (await crear({ destinatarios: [ana] }).expect(201)).body;
      expect((await dueno().get('/notificaciones/canales').expect(200)).body.map((c: { id: string }) => c.id)).toStrictEqual([wa.id]);
      expect((await dueno().patch(`/notificaciones/canales/${vieja.id}`).send({ activo: false })).status).toBe(403);
      await dueno().delete(`/notificaciones/canales/${vieja.id}`).expect(200);
    });
  });

  describe('evento', () => {
    const canalWa = async () => {
      await conWebhook();
      return (await crear({ destinatarios: [ana] }).expect(201)).body;
    };

    it('PEDIDO_MODIFICADO_CLIENTE + NEGOCIO + canal WhatsApp: se crea activo; GET lo lista con su canal; duplicado 409', async () => {
      const c = await canalWa();
      const body = { evento: EVENTO, audiencia: 'NEGOCIO', canalConfigId: c.id };
      const ev = (await dueno().post('/notificaciones/eventos', body).expect(201)).body;
      expect(ev).toMatchObject({ evento: EVENTO, audiencia: 'NEGOCIO', activo: true, canalConfigId: c.id });
      const lista = (await dueno().get('/notificaciones/eventos').expect(200)).body;
      expect(lista).toHaveLength(1);
      expect(lista[0].canalConfig.tipo).toBe('WHATSAPP');
      expect((await dueno().post('/notificaciones/eventos', body)).status).toBe(409);
      expect((await dueno().patch(`/notificaciones/eventos/${ev.id}`).send({ activo: false }).expect(200)).body.activo).toBe(false);
    });

    it('audiencia CLIENTE con el evento nuevo → 400', async () => {
      const c = await canalWa();
      expect((await dueno().post('/notificaciones/eventos', { evento: EVENTO, audiencia: 'CLIENTE', canalConfigId: c.id })).status).toBe(400);
    });

    it('un evento de menudeo en mayoreo → 403 (con canal WhatsApp o cualquier otro)', async () => {
      const c = await canalWa();
      for (const evento of ['PEDIDO_RECIBIDO', 'PAGO_CONFIRMADO', 'PEDIDO_CONFIRMADO']) {
        expect((await dueno().post('/notificaciones/eventos', { evento, audiencia: 'NEGOCIO', canalConfigId: c.id })).status).toBe(403);
      }
    });

    it('filas viejas de menudeo no se muestran ni se editan, pero se pueden borrar', async () => {
      const c = await canalWa();
      const vieja = await s.h.prisma.notificacionCanalConfig.create({ data: { tenantId: s.base.tenant.id, tipo: 'CORREO', config: {} } });
      const evViejo = await s.h.prisma.notificacionEventoConfig.create({
        data: { tenantId: s.base.tenant.id, evento: 'PEDIDO_RECIBIDO', audiencia: 'NEGOCIO', canalConfigId: vieja.id },
      });
      await dueno().post('/notificaciones/eventos', { evento: EVENTO, audiencia: 'NEGOCIO', canalConfigId: c.id }).expect(201);
      expect((await dueno().get('/notificaciones/eventos').expect(200)).body.map((e: { evento: string }) => e.evento)).toStrictEqual([EVENTO]);
      expect((await dueno().patch(`/notificaciones/eventos/${evViejo.id}`).send({ activo: false })).status).toBe(403);
      await dueno().delete(`/notificaciones/eventos/${evViejo.id}`).expect(200);
    });

    it('borrar el canal WhatsApp borra en cascada su evento', async () => {
      const c = await canalWa();
      await dueno().post('/notificaciones/eventos', { evento: EVENTO, audiencia: 'NEGOCIO', canalConfigId: c.id }).expect(201);
      await dueno().delete(`/notificaciones/canales/${c.id}`).expect(200);
      expect((await dueno().get('/notificaciones/eventos').expect(200)).body).toStrictEqual([]);
    });

    it('canal de otro negocio → 404', async () => {
      const otro = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
      await s.h.prisma.tenant.update({ where: { id: otro.tenant.id }, data: { botWebhookUrl: 'https://bot.example/otro' } });
      const apiOtro = auth(s.h, tokenFor(s.h.jwt, otro.dueno, otro.tenant.id, 'DUENO'));
      const ajeno = (await apiOtro.post('/notificaciones/canales', { tipo: 'WHATSAPP', config: { destinatarios: [ana] } }).expect(201)).body;
      expect((await dueno().post('/notificaciones/eventos', { evento: EVENTO, audiencia: 'NEGOCIO', canalConfigId: ajeno.id })).status).toBe(404);
    });
  });

  it('aislamiento: cada negocio ve solo su canal; Gerente y Operador 403', async () => {
    await conWebhook();
    const mio = (await crear({ destinatarios: [ana] }).expect(201)).body;
    const otro = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
    const apiOtro = auth(s.h, tokenFor(s.h.jwt, otro.dueno, otro.tenant.id, 'DUENO'));
    expect((await apiOtro.get('/notificaciones/canales').expect(200)).body).toStrictEqual([]);
    expect((await apiOtro.patch(`/notificaciones/canales/${mio.id}`).send({ activo: false })).status).toBe(404);
    for (const rol of ['GERENTE', 'OPERADOR'] as const) {
      const api = apiRol(s.h, s.base, rol);
      expectError(await api.get('/notificaciones/canales'), 403, MSG_403);
      expectError(await api.post('/notificaciones/canales', { tipo: 'WHATSAPP', config: { destinatarios: [ana] } }), 403, MSG_403);
      expectError(await api.patch(`/notificaciones/canales/${mio.id}`).send({ activo: false }), 403, MSG_403);
      expectError(await api.post('/notificaciones/eventos', { evento: EVENTO, audiencia: 'NEGOCIO', canalConfigId: mio.id }), 403, MSG_403);
    }
  });
});

describe.each([['RETAIL_B2C'], ['HOTEL']] as const)('Notificaciones WhatsApp · %s no lo ve', (tipoStorefront) => {
  const s = usarSuite({ seed: { tipoStorefront } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');

  it('canal WhatsApp y evento nuevo → 403, aunque haya webhook', async () => {
    await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { botWebhookUrl: 'https://bot.example/hook' } });
    expect((await dueno().post('/notificaciones/canales', { tipo: 'WHATSAPP', config: { destinatarios: [ana] } })).status).toBe(403);
    const correo = (await dueno().post('/notificaciones/canales', { tipo: 'CORREO', config: {} }).expect(201)).body;
    expect((await dueno().post('/notificaciones/eventos', { evento: EVENTO, audiencia: 'NEGOCIO', canalConfigId: correo.id })).status).toBe(403);
  });

  it('sigue igual que siempre: Correo y Telegram, y todos los eventos de menudeo con ellos', async () => {
    const correo = (await dueno().post('/notificaciones/canales', { tipo: 'CORREO', config: { correoDestino: 'a@b.com' } }).expect(201)).body;
    await dueno().post('/notificaciones/canales', { tipo: 'TELEGRAM', config: {} }).expect(201);
    for (const evento of ['PEDIDO_RECIBIDO', 'PAGO_CONFIRMADO']) {
      await dueno().post('/notificaciones/eventos', { evento, audiencia: 'NEGOCIO', canalConfigId: correo.id }).expect(201);
    }
    expect((await dueno().get('/notificaciones/canales').expect(200)).body).toHaveLength(2);
    expect((await dueno().get('/notificaciones/eventos').expect(200)).body).toHaveLength(2);
  });

  it('un evento de menudeo con un canal WhatsApp (forzado en la base) → 400 al intentar crearlo', async () => {
    const wa = await s.h.prisma.notificacionCanalConfig.create({
      data: { tenantId: s.base.tenant.id, tipo: 'WHATSAPP', config: { destinatarios: [] } },
    });
    expect((await dueno().post('/notificaciones/eventos', { evento: 'PEDIDO_RECIBIDO', audiencia: 'NEGOCIO', canalConfigId: wa.id })).status).toBe(400);
  });
});
