import { auth, usarSuite } from './helpers';
import { apiRol } from './b2b-helpers';
import { expectError } from './exacto';

// Resumen semanal por correo (mayoreo): SOLO configuración (canal CORREO con lista de direcciones + evento RESUMEN_SEMANAL).
const MSG_403 = 'No tienes permiso para realizar esta acción';
const EVENTO = 'RESUMEN_SEMANAL';
const config = (extra: Record<string, unknown> = {}) => ({
  nombreRemitente: 'Banetto',
  correos: ['Ana@Example.com', 'luis@example.com'],
  ...extra,
});

describe('Resumen semanal · configuración en mayoreo', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  const crear = (cfg: unknown, extra: Record<string, unknown> = {}) =>
    dueno().post('/notificaciones/canales', {
      tipo: 'CORREO',
      config: cfg,
      ...extra,
    });

  describe('canal Correo', () => {
    it('alta válida: nace INACTIVO, normaliza las direcciones y deja solo nombreRemitente y correos', async () => {
      const c = (await crear(config({ otraLlave: 1 })).expect(201)).body;
      expect(c).toMatchObject({ tipo: 'CORREO', activo: false });
      expect(c.config).toStrictEqual({
        nombreRemitente: 'Banetto',
        correos: ['ana@example.com', 'luis@example.com'],
      });
    });

    it('activarlo exige al menos una dirección (409), al crear y al editar', async () => {
      const msg =
        'Un canal de correo activo necesita al menos una dirección. Desactívalo primero o agrega una';
      expectError(
        await crear(config({ correos: [] }), { activo: true }),
        409,
        msg,
      );
      const c = (await crear(config({ correos: [] })).expect(201)).body;
      expect(c.activo).toBe(false);
      expectError(
        await dueno()
          .patch(`/notificaciones/canales/${c.id}`)
          .send({ activo: true }),
        409,
        msg,
      );
      const activado = (
        await dueno()
          .patch(`/notificaciones/canales/${c.id}`)
          .send({ activo: true, config: config() })
          .expect(200)
      ).body;
      expect(activado.activo).toBe(true);
      // Ya activo, vaciar la lista también se rechaza.
      expectError(
        await dueno()
          .patch(`/notificaciones/canales/${c.id}`)
          .send({ config: config({ correos: [] }) }),
        409,
        msg,
      );
      // Desactivar un canal sin direcciones sí se puede.
      await dueno()
        .patch(`/notificaciones/canales/${c.id}`)
        .send({ activo: false, config: config({ correos: [] }) })
        .expect(200);
    });

    it('validaciones: nombre, máximo 10, repetidos (sin importar mayúsculas), direcciones inválidas', async () => {
      expect((await crear({ correos: ['a@b.co'] })).status).toBe(400); // sin nombreRemitente
      expect(
        (await crear(config({ nombreRemitente: 'Hola\nBcc: x@y.co' }))).status,
      ).toBe(400);
      expect(
        (await crear(config({ nombreRemitente: 'A <b@c.co>' }))).status,
      ).toBe(400);
      expect((await crear(config({ correos: 'a@b.co' }))).status).toBe(400);
      const once = Array.from({ length: 11 }, (_, i) => `p${i}@example.com`);
      expectError(
        await crear(config({ correos: once })),
        400,
        'Máximo 10 direcciones de correo',
      );
      expectError(
        await crear(config({ correos: ['a@b.co', 'A@B.CO'] })),
        400,
        'La dirección a@b.co está repetida',
      );
      for (const mala of [
        'sin-arroba',
        'a@b',
        'a b@c.co',
        'a@b.co, c@d.co',
        '<a@b.co>',
        '',
      ]) {
        expect((await crear(config({ correos: [mala] }))).status).toBe(400);
      }
      const diez = once.slice(0, 10);
      expect((await crear(config({ correos: diez }))).status).toBe(201);
    });

    it('un solo canal Correo por negocio (409) y los cambios de config se validan al editar', async () => {
      const c = (await crear(config()).expect(201)).body;
      expectError(
        await crear(config()),
        409,
        'Ya existe un canal de este tipo para tu negocio',
      );
      expect(
        (
          await dueno()
            .patch(`/notificaciones/canales/${c.id}`)
            .send({ config: config({ correos: ['mala'] }) })
        ).status,
      ).toBe(400);
      const ok = (
        await dueno()
          .patch(`/notificaciones/canales/${c.id}`)
          .send({ config: config({ correos: ['nuevo@example.com'] }) })
          .expect(200)
      ).body;
      expect(ok.config.correos).toStrictEqual(['nuevo@example.com']);
    });

    it('Telegram sigue en 403 en mayoreo', async () => {
      expect(
        (
          await dueno().post('/notificaciones/canales', {
            tipo: 'TELEGRAM',
            config: {},
          })
        ).status,
      ).toBe(403);
    });
  });

  describe('evento Resumen semanal', () => {
    const canalCorreo = async () => (await crear(config()).expect(201)).body;

    it('RESUMEN_SEMANAL + NEGOCIO + canal Correo: se crea activo, se lista con su canal y el duplicado da 409', async () => {
      const c = await canalCorreo();
      const body = {
        evento: EVENTO,
        audiencia: 'NEGOCIO',
        canalConfigId: c.id,
      };
      const ev = (
        await dueno().post('/notificaciones/eventos', body).expect(201)
      ).body;
      expect(ev).toMatchObject({
        evento: EVENTO,
        audiencia: 'NEGOCIO',
        activo: true,
        canalConfigId: c.id,
      });
      const lista = (await dueno().get('/notificaciones/eventos').expect(200))
        .body;
      expect(lista.map((e: { evento: string }) => e.evento)).toStrictEqual([
        EVENTO,
      ]);
      expect(lista[0].canalConfig.tipo).toBe('CORREO');
      expect((await dueno().post('/notificaciones/eventos', body)).status).toBe(
        409,
      );
    });

    it('combinaciones inválidas: audiencia CLIENTE 400; con canal WhatsApp 400; «Pedido modificado» con Correo 400; evento de menudeo 403', async () => {
      const c = await canalCorreo();
      expect(
        (
          await dueno().post('/notificaciones/eventos', {
            evento: EVENTO,
            audiencia: 'CLIENTE',
            canalConfigId: c.id,
          })
        ).status,
      ).toBe(400);
      expectError(
        await dueno().post('/notificaciones/eventos', {
          evento: 'PEDIDO_MODIFICADO_CLIENTE',
          audiencia: 'NEGOCIO',
          canalConfigId: c.id,
        }),
        400,
        'Este evento solo puede avisar por WhatsApp',
      );
      await s.h.prisma.tenant.update({
        where: { id: s.base.tenant.id },
        data: { botWebhookUrl: 'https://bot.example/hook' },
      });
      const wa = (
        await dueno()
          .post('/notificaciones/canales', {
            tipo: 'WHATSAPP',
            config: {
              destinatarios: [{ nombre: 'Ana', telefono: '5512345678' }],
            },
          })
          .expect(201)
      ).body;
      expectError(
        await dueno().post('/notificaciones/eventos', {
          evento: EVENTO,
          audiencia: 'NEGOCIO',
          canalConfigId: wa.id,
        }),
        400,
        'Este evento solo puede avisar por Correo',
      );
      expectError(
        await dueno().post('/notificaciones/eventos', {
          evento: 'PEDIDO_RECIBIDO',
          audiencia: 'NEGOCIO',
          canalConfigId: c.id,
        }),
        403,
        'Los negocios de mayoreo no usan los eventos de menudeo',
      );
    });

    it('permisos: solo Dueño (Gerente y Operador 403, sin sesión 401)', async () => {
      const c = await canalCorreo();
      for (const rol of ['GERENTE', 'OPERADOR'] as const) {
        const api = apiRol(s.h, s.base, rol);
        expectError(
          await api.post('/notificaciones/canales', {
            tipo: 'CORREO',
            config: config(),
          }),
          403,
          MSG_403,
        );
        expectError(
          await api
            .patch(`/notificaciones/canales/${c.id}`)
            .send({ activo: true }),
          403,
          MSG_403,
        );
        expectError(
          await api.post('/notificaciones/eventos', {
            evento: EVENTO,
            audiencia: 'NEGOCIO',
            canalConfigId: c.id,
          }),
          403,
          MSG_403,
        );
      }
      expect((await auth(s.h, 'x').get('/notificaciones/canales')).status).toBe(
        401,
      );
    });
  });
});

describe.each([['RETAIL_B2C'], ['HOTEL']] as const)(
  'Resumen semanal · NO aplica a %s (sin cambios)',
  (tipoStorefront) => {
    const s = usarSuite({ seed: { tipoStorefront } });
    const dueno = () => apiRol(s.h, s.base, 'DUENO');

    it('el canal Correo sigue aceptando cualquier config y nace activo; el evento nuevo da 403', async () => {
      const c = (
        await dueno()
          .post('/notificaciones/canales', {
            tipo: 'CORREO',
            config: { nombreRemitente: 'Tienda' },
          })
          .expect(201)
      ).body;
      expect(c).toMatchObject({
        activo: true,
        config: { nombreRemitente: 'Tienda' },
      });
      expectError(
        await dueno().post('/notificaciones/eventos', {
          evento: EVENTO,
          audiencia: 'NEGOCIO',
          canalConfigId: c.id,
        }),
        403,
        'El evento «Resumen semanal» solo está disponible para negocios de mayoreo',
      );
      // El evento de menudeo con Correo sigue igual.
      await dueno()
        .post('/notificaciones/eventos', {
          evento: 'PEDIDO_RECIBIDO',
          audiencia: 'NEGOCIO',
          canalConfigId: c.id,
        })
        .expect(201);
    });
  },
);
