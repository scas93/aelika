import { Logger } from '@nestjs/common';
import request from 'supertest';
import { seedBase } from './db';
import { usarSuite } from './helpers';
import { altaClienteB2bDePrueba, apiRol } from './b2b-helpers';
import { CONCURRENCIA_AVISOS } from '../../src/notificaciones/avisos-internos/aviso-pedido-modificado.service';

// Cambio C · aviso interno por WhatsApp cuando un cliente B2B modifica su pedido desde el portal.
// La red está sustituida: `fakes.avisoWebhook` recibe { url, secreto, cuerpo } y nada sale a Botpress.
// Reloj de la suite: miércoles 2026-09-30 10:00 CDMX; el pedido base es de la semana del lunes 28 de septiembre.
describe('Avisos internos · pedido modificado por el cliente', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const http = () => request(s.h.app.getHttpServer());
  const H = { 'x-portal-request': '1' };
  const TEL = '3331006915';
  const URL_HOOK = 'https://bot.example/hook-secreto-123';
  const SECRETO = 'secreto-bp';
  let idem = 0;
  const llave = () => `llave-c-${String(++idem).padStart(6, '0')}`;
  const slug = () => s.base.tenant.slug;
  const A = () => s.base.productoA.id;
  const e = (fecha: string, cantidad: number) => ({ fecha, items: [{ productId: A(), cantidad }] });

  const entorno = { ...process.env };
  beforeEach(async () => {
    process.env.PORTAL_CODIGO_EN_LOG = 'true';
    delete process.env.RAILWAY_PROJECT_NAME;
    await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { pedidoB2bMinimoPiezas: 0, pedidoB2bModoCobro: 'AL_FINAL' } });
  });
  afterEach(() => {
    process.env = { ...entorno };
    jest.restoreAllMocks();
  });

  const cookieDe = (res: request.Response, nombre: string) =>
    ((res.headers['set-cookie'] as unknown as string[]) ?? []).find((c) => c.startsWith(`${nombre}=`));
  async function entrar(sl = slug(), telefono = TEL) {
    await http().post('/portal/acceso/pedir-codigo').set(H).send({ slug: sl, telefono }).expect(200);
    const llamadas = s.h.fakes.enviarCodigoAcceso.mock.calls;
    const codigo = llamadas[llamadas.length - 1][0].codigo as string;
    const v = await http().post('/portal/acceso/verificar').set(H).send({ slug: sl, telefono, codigo }).expect(200);
    const nombre = `__Host-portal_${sl}`;
    return `${nombre}=${(cookieDe(v, nombre) as string).split(';')[0].split('=')[1]}`;
  }
  async function preparar() {
    await altaClienteB2bDePrueba(s.h, s.base, { contactoTelefono: TEL });
    const cookie = await entrar();
    const r = await http()
      .post('/portal/pedidos')
      .set(H)
      .set('Cookie', cookie)
      .set('Idempotency-Key', llave())
      .send({ slug: slug(), entregas: [e('2026-10-02', 2), e('2026-10-03', 3)] })
      .expect(201);
    const folio = r.body.pedidos[0].folio as string;
    const orden = await s.h.prisma.order.findFirstOrThrow({ where: { folio, tipo: 'B2B' } });
    return { cookie, folio, orderId: orden.id };
  }
  const modificar = async (cookie: string, folio: string, cuerpo: Record<string, unknown>, version?: string) => {
    const v =
      version ?? (await http().get(`/portal/pedidos/${folio}?slug=${slug()}`).set('Cookie', cookie).expect(200)).body.version;
    return http()
      .patch(`/portal/pedidos/${folio}`)
      .set(H)
      .set('Cookie', cookie)
      .send({ slug: slug(), version: v, entregas: [], ...cuerpo });
  };
  const editarCantidad = (cookie: string, folio: string, n = 4) => modificar(cookie, folio, { entregas: [e('2026-10-03', n)] });
  const registros = (tenantId = s.base.tenant.id) =>
    s.h.prisma.avisoInternoEnvio.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });

  const ANA = { id: '11111111-1111-4111-8111-111111111111', nombre: 'Ana', telefono: '5512345678' };
  const LUIS = { id: '22222222-2222-4222-8222-222222222222', nombre: 'Luis', telefono: '+18188140000' };

  async function configurar(
    tenantId = s.base.tenant.id,
    o: { destinatarios?: unknown[]; eventoActivo?: boolean; canalActivo?: boolean; sinEvento?: boolean; webhook?: string | null } = {},
  ) {
    await s.h.prisma.tenant.update({
      where: { id: tenantId },
      data: { botWebhookUrl: o.webhook === undefined ? URL_HOOK : o.webhook, botWebhookSecret: SECRETO },
    });
    const canal = await s.h.prisma.notificacionCanalConfig.create({
      data: { tenantId, tipo: 'WHATSAPP', activo: o.canalActivo ?? true, config: { destinatarios: o.destinatarios ?? [ANA, LUIS] } },
    });
    if (!o.sinEvento) {
      await s.h.prisma.notificacionEventoConfig.create({
        data: { tenantId, evento: 'PEDIDO_MODIFICADO_CLIENTE', audiencia: 'NEGOCIO', canalConfigId: canal.id, activo: o.eventoActivo ?? true },
      });
    }
    return canal;
  }
  const llamadas = () => s.h.fakes.avisoWebhook.mock.calls.map(([p]) => p);

  describe('disparo', () => {
    it('la primera edición que prende la marca avisa a cada destinatario, con el payload exacto y sin esperar al cliente', async () => {
      const canal = await configurar();
      const { cookie, folio, orderId } = await preparar();
      expect(llamadas()).toHaveLength(0); // crear pedido no avisa
      const r = await editarCantidad(cookie, folio);
      expect(r.status).toBe(200);
      await s.h.esperarAvisos();

      const filas = await registros();
      expect(filas).toHaveLength(2);
      expect(llamadas()).toHaveLength(2);
      const deAna = llamadas().find((p) => p.cuerpo.telefono === '+525512345678');
      const fila = filas.find((f) => f.destinatarioId === ANA.id)!;
      expect(deAna).toStrictEqual({
        url: URL_HOOK,
        secreto: SECRETO,
        cuerpo: {
          tipo: 'AVISO_INTERNO',
          correlacionId: fila.id,
          negocio: slug(),
          telefono: '+525512345678',
          categoria: 'UTILITY',
          plantilla: { nombre: 'pedido_modificado_cliente', idioma: 'es_MX' },
          variables: ['Cafetería La Esquina', '28 de septiembre'],
          boton: { tipo: 'URL_DINAMICA', indice: 0, valor: `dashboard/pedidos-b2b?pedido=${orderId}` },
        },
      });
      // Internacional: tal cual, completo.
      expect(llamadas().find((p) => p.cuerpo.telefono === '+18188140000')).toBeDefined();
      expect(fila).toMatchObject({
        tenantId: s.base.tenant.id,
        orderId,
        canalConfigId: canal.id,
        evento: 'PEDIDO_MODIFICADO_CLIENTE',
        folio,
        negocioNombre: 'Cafetería La Esquina',
        destinatarioNombre: 'Ana',
        telefonoUltimos4: '5678',
        estado: 'EN_CURSO',
        motivo: null,
        resueltoAt: null,
      });
    });

    it('un cambio solo de nota también avisa', async () => {
      await configurar();
      const { cookie, folio } = await preparar();
      expect((await modificar(cookie, folio, { notaCliente: 'Por favor sin azúcar' })).status).toBe(200);
      await s.h.esperarAvisos();
      expect(llamadas()).toHaveLength(2);
    });

    it('con la marca ya prendida no se avisa de nuevo; tras apagarla (revisado), la siguiente edición sí', async () => {
      await configurar();
      const { cookie, folio, orderId } = await preparar();
      await editarCantidad(cookie, folio, 4);
      await s.h.esperarAvisos();
      expect(llamadas()).toHaveLength(2);

      jest.setSystemTime(new Date('2026-09-30T16:00:05.000Z'));
      expect((await editarCantidad(cookie, folio, 5)).status).toBe(200);
      await s.h.esperarAvisos();
      expect(llamadas()).toHaveLength(2);

      await apiRol(s.h, s.base, 'GERENTE').patch(`/pedidos-b2b/${orderId}/marcar-revisado`).expect(200);
      jest.setSystemTime(new Date('2026-09-30T16:00:10.000Z'));
      expect((await editarCantidad(cookie, folio, 6)).status).toBe(200);
      await s.h.esperarAvisos();
      expect(llamadas()).toHaveLength(4);
    });

    it('una edición sin cambios reales no avisa', async () => {
      await configurar();
      const { cookie, folio } = await preparar();
      const r = await modificar(cookie, folio, { entregas: [e('2026-10-03', 3)] });
      expect(r.body.cambio).toBe(false);
      await s.h.esperarAvisos();
      expect(llamadas()).toHaveLength(0);
      expect(await registros()).toHaveLength(0);
    });

    it('las acciones del panel no avisan (confirmar, marcar revisado, editar)', async () => {
      await configurar();
      const { orderId, folio, cookie } = await preparar();
      const gerente = apiRol(s.h, s.base, 'GERENTE');
      await gerente.patch(`/pedidos-b2b/${orderId}/marcar-revisado`).expect(200);
      await gerente.patch(`/pedidos-b2b/${orderId}/avanzar`).expect(200);
      await s.h.esperarAvisos();
      expect(llamadas()).toHaveLength(0);
      void folio;
      void cookie;
    });

    it('dos ediciones simultáneas con la misma versión: una gana y se avisa UNA sola vez por destinatario', async () => {
      await configurar();
      const { cookie, folio } = await preparar();
      const v = (await http().get(`/portal/pedidos/${folio}?slug=${slug()}`).set('Cookie', cookie).expect(200)).body.version;
      jest.setSystemTime(new Date('2026-09-30T16:00:05.000Z'));
      const [a, b] = await Promise.all([
        modificar(cookie, folio, { entregas: [e('2026-10-03', 4)] }, v),
        modificar(cookie, folio, { entregas: [e('2026-10-03', 5)] }, v),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      await s.h.esperarAvisos();
      expect(llamadas()).toHaveLength(2);
    });
  });

  describe('condiciones para enviar', () => {
    const casos: [string, Parameters<typeof configurar>[1]][] = [
      ['sin fila del evento', { sinEvento: true }],
      ['evento inactivo', { eventoActivo: false }],
      ['canal inactivo', { canalActivo: false }],
      ['canal sin destinatarios', { destinatarios: [] }],
      ['sin URL de webhook', { webhook: null }],
      ['URL de webhook en blanco', { webhook: '   ' }],
    ];
    it.each(casos)('%s: no se envía nada, no se registra nada y la edición sale bien', async (_nombre, opciones) => {
      await configurar(s.base.tenant.id, opciones);
      const { cookie, folio } = await preparar();
      const r = await editarCantidad(cookie, folio);
      expect(r.status).toBe(200);
      expect(r.body.pedido.modificadoPorCliente).toBe(true);
      await s.h.esperarAvisos();
      expect(llamadas()).toHaveLength(0);
      expect(await registros()).toHaveLength(0);
    });

    it('sin canal configurado nada se rompe', async () => {
      const { cookie, folio } = await preparar();
      expect((await editarCantidad(cookie, folio)).status).toBe(200);
      await s.h.esperarAvisos();
      expect(llamadas()).toHaveLength(0);
    });

    it('el secreto del webhook es opcional', async () => {
      await configurar();
      await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { botWebhookSecret: null } });
      const { cookie, folio } = await preparar();
      await editarCantidad(cookie, folio);
      await s.h.esperarAvisos();
      expect(llamadas()[0].secreto).toBeNull();
    });
  });

  describe('fallos del webhook', () => {
    const FALLOS: [string, () => void, string][] = [
      ['HTTP 500', () => s.h.fakes.avisoWebhook.mockResolvedValue({ ok: false, status: 500 }), 'HTTP 500'],
      [
        'timeout de 10 s',
        () => s.h.fakes.avisoWebhook.mockRejectedValue(Object.assign(new Error(`timeout contra ${URL_HOOK}`), { name: 'TimeoutError' })),
        'Sin respuesta de Botpress (timeout)',
      ],
      ['error de red', () => s.h.fakes.avisoWebhook.mockRejectedValue(new Error(`ECONNREFUSED ${URL_HOOK}`)), 'Error de red'],
    ];
    it.each(FALLOS)('%s: el envío queda FALLO (definitivo) y la edición del cliente sale bien', async (_n, preparaFallo, motivo) => {
      await configurar();
      preparaFallo();
      const { cookie, folio } = await preparar();
      const logs: string[] = [];
      for (const m of ['log', 'warn', 'error'] as const) {
        jest.spyOn(Logger.prototype, m).mockImplementation((msg: unknown) => void logs.push(String(msg)));
      }
      const r = await editarCantidad(cookie, folio);
      expect(r.status).toBe(200);
      expect(r.body.cambio).toBe(true);
      await s.h.esperarAvisos();
      const filas = await registros();
      expect(filas).toHaveLength(2);
      for (const f of filas) {
        expect(f.estado).toBe('FALLO');
        expect(f.motivo).toBe(motivo);
        expect(f.resueltoAt).not.toBeNull();
      }
      // Ni la URL del webhook ni ningún teléfono en los logs.
      const todo = logs.join('\n');
      expect(todo).not.toContain('hook-secreto');
      expect(todo).not.toMatch(/5512345678|8188140000/);
      // Sin reintentos.
      expect(llamadas()).toHaveLength(2);
    });

    it('un fallo de un destinatario no impide avisar a los demás', async () => {
      await configurar();
      s.h.fakes.avisoWebhook.mockImplementation(async (p: { cuerpo: { telefono: string } }) =>
        p.cuerpo.telefono === '+525512345678' ? { ok: false, status: 502 } : { ok: true, status: 200 },
      );
      const { cookie, folio } = await preparar();
      await editarCantidad(cookie, folio);
      await s.h.esperarAvisos();
      const filas = await registros();
      expect(filas.find((f) => f.destinatarioId === ANA.id)!.estado).toBe('FALLO');
      expect(filas.find((f) => f.destinatarioId === LUIS.id)!.estado).toBe('EN_CURSO');
    });
  });

  describe('varios destinatarios', () => {
    it('10 destinatarios: uno por teléfono, con a lo más CONCURRENCIA_AVISOS envíos simultáneos', async () => {
      const diez = Array.from({ length: 10 }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        nombre: `P${i}`,
        telefono: `551234567${i}`,
      }));
      await configurar(s.base.tenant.id, { destinatarios: diez });
      let activos = 0;
      let maximo = 0;
      s.h.fakes.avisoWebhook.mockImplementation(async () => {
        activos += 1;
        maximo = Math.max(maximo, activos);
        await new Promise((r) => setTimeout(r, 15));
        activos -= 1;
        return { ok: true, status: 200 };
      });
      const { cookie, folio } = await preparar();
      await editarCantidad(cookie, folio);
      await s.h.esperarAvisos();
      expect(llamadas()).toHaveLength(10);
      expect(new Set(llamadas().map((p) => p.cuerpo.telefono)).size).toBe(10);
      expect(maximo).toBeGreaterThan(1);
      expect(maximo).toBeLessThanOrEqual(CONCURRENCIA_AVISOS);
      expect((await registros()).map((f) => f.telefonoUltimos4).sort()).toEqual(diez.map((d) => d.telefono.slice(-4)).sort());
    });

    it('la lista vigente al momento del envío: un destinatario agregado antes de la edición sí recibe', async () => {
      const canal = await configurar(s.base.tenant.id, { destinatarios: [ANA] });
      const { cookie, folio } = await preparar();
      await s.h.prisma.notificacionCanalConfig.update({ where: { id: canal.id }, data: { config: { destinatarios: [ANA, LUIS] } } });
      await editarCantidad(cookie, folio);
      await s.h.esperarAvisos();
      expect(llamadas()).toHaveLength(2);
    });
  });

  describe('privacidad del registro', () => {
    it('la tabla guarda solo los últimos 4 dígitos: ningún campo contiene el teléfono completo', async () => {
      await configurar();
      const { cookie, folio } = await preparar();
      await editarCantidad(cookie, folio);
      await s.h.esperarAvisos();
      const texto = JSON.stringify(await registros());
      expect(texto).not.toContain('5512345678');
      expect(texto).not.toContain('8188140000');
      expect(texto).toContain('5678');
      expect(texto).toContain('0000');
    });
  });

  describe('callback PATCH /internal/avisos-pedido/:id/estado', () => {
    const KEY = () => `key-${slug()}`;
    const cb = (id: string, cuerpo: unknown, llaveApi: string | null = KEY()) => {
      const r = http().patch(`/internal/avisos-pedido/${id}/estado`);
      if (llaveApi) r.set('X-Api-Key', llaveApi);
      return r.send(cuerpo as object);
    };
    async function unEnvio() {
      await configurar(s.base.tenant.id, { destinatarios: [ANA] });
      const { cookie, folio } = await preparar();
      await editarCantidad(cookie, folio);
      await s.h.esperarAvisos();
      return (await registros())[0];
    }

    it('EXITO: responde el estado vigente y lo guarda con su fecha', async () => {
      const f = await unEnvio();
      const r = await cb(f.id, { estado: 'EXITO' });
      expect(r.status).toBe(200);
      expect(r.body).toStrictEqual({ id: f.id, estado: 'EXITO' });
      const despues = await s.h.prisma.avisoInternoEnvio.findUniqueOrThrow({ where: { id: f.id } });
      expect(despues).toMatchObject({ estado: 'EXITO', motivo: null });
      expect(despues.resueltoAt).not.toBeNull();
    });

    it('FALLO con motivo: el motivo se sanea (una línea, secuencias largas de dígitos fuera, 200 caracteres)', async () => {
      const f = await unEnvio();
      const crudo = `Plantilla rechazada\n(131026) para 5512345678 ${'x'.repeat(400)}`;
      const r = await cb(f.id, { estado: 'FALLO', motivo: crudo });
      expect(r.status).toBe(200);
      const despues = await s.h.prisma.avisoInternoEnvio.findUniqueOrThrow({ where: { id: f.id } });
      expect(despues.estado).toBe('FALLO');
      expect(despues.motivo).not.toMatch(/\n|5512345678/);
      expect(despues.motivo!.length).toBeLessThanOrEqual(200);
      expect(despues.motivo).toContain('***');
    });

    it('repetido: 200 con el estado vigente y sin cambios; un estado final es inmutable (EXITO no pasa a FALLO ni al revés)', async () => {
      const f = await unEnvio();
      await cb(f.id, { estado: 'EXITO' }).expect(200);
      const antes = await s.h.prisma.avisoInternoEnvio.findUniqueOrThrow({ where: { id: f.id } });
      expect((await cb(f.id, { estado: 'EXITO' })).body).toStrictEqual({ id: f.id, estado: 'EXITO' });
      const r = await cb(f.id, { estado: 'FALLO', motivo: 'tarde' });
      expect(r.status).toBe(200);
      expect(r.body).toStrictEqual({ id: f.id, estado: 'EXITO' });
      const despues = await s.h.prisma.avisoInternoEnvio.findUniqueOrThrow({ where: { id: f.id } });
      expect(despues).toMatchObject({ estado: 'EXITO', motivo: null });
      expect(despues.resueltoAt).toStrictEqual(antes.resueltoAt);
    });

    it('un envío que ya quedó FALLO por el webhook no lo cambia un EXITO tardío', async () => {
      await configurar(s.base.tenant.id, { destinatarios: [ANA] });
      s.h.fakes.avisoWebhook.mockResolvedValue({ ok: false, status: 500 });
      const { cookie, folio } = await preparar();
      await editarCantidad(cookie, folio);
      await s.h.esperarAvisos();
      const f = (await registros())[0];
      expect((await cb(f.id, { estado: 'EXITO' })).body).toStrictEqual({ id: f.id, estado: 'FALLO' });
    });

    it('llave inválida o ausente: 401', async () => {
      const f = await unEnvio();
      expect((await cb(f.id, { estado: 'EXITO' }, 'llave-mala')).status).toBe(401);
      expect((await cb(f.id, { estado: 'EXITO' }, null)).status).toBe(401);
      expect((await s.h.prisma.avisoInternoEnvio.findUniqueOrThrow({ where: { id: f.id } })).estado).toBe('EN_CURSO');
    });

    it('id inexistente, mal formado o de otro negocio: el mismo 404', async () => {
      const f = await unEnvio();
      const otro = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
      expect((await cb(f.id, { estado: 'EXITO' }, `key-${otro.tenant.slug}`)).status).toBe(404);
      expect((await cb('00000000-0000-4000-8000-000000000000', { estado: 'EXITO' })).status).toBe(404);
      expect((await cb('no-es-un-id', { estado: 'EXITO' })).status).toBe(404);
      expect((await s.h.prisma.avisoInternoEnvio.findUniqueOrThrow({ where: { id: f.id } })).estado).toBe('EN_CURSO');
    });

    it('cuerpo inválido: 400 (estado desconocido, motivo de más de 500 caracteres, sin estado)', async () => {
      const f = await unEnvio();
      expect((await cb(f.id, { estado: 'OK' })).status).toBe(400);
      expect((await cb(f.id, { estado: 'FALLO', motivo: 'x'.repeat(501) })).status).toBe(400);
      expect((await cb(f.id, {})).status).toBe(400);
    });
  });

  describe('aislamiento entre negocios', () => {
    it('la edición de un negocio avisa solo a SUS destinatarios y registra solo en SU negocio', async () => {
      const otro = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
      const OTRO = { id: '33333333-3333-4333-8333-333333333333', nombre: 'Otra', telefono: '5599990000' };
      await configurar(s.base.tenant.id, { destinatarios: [ANA] });
      await configurar(otro.tenant.id, { destinatarios: [OTRO], webhook: 'https://otro.example/hook' });
      const { cookie, folio } = await preparar();
      await editarCantidad(cookie, folio);
      await s.h.esperarAvisos();
      expect(llamadas()).toHaveLength(1);
      expect(llamadas()[0]).toMatchObject({ url: URL_HOOK });
      expect(llamadas()[0].cuerpo.telefono).toBe('+525512345678');
      expect(await registros()).toHaveLength(1);
      expect(await registros(otro.tenant.id)).toHaveLength(0);
    });

    it('un negocio de menudeo con la configuración forzada en la base nunca envía', async () => {
      const menudeo = await seedBase(s.h.prisma, { slug: 'menudeo-x', tipoStorefront: 'RETAIL_B2C' });
      await configurar(menudeo.tenant.id);
      const avisos = (s.h.app as unknown as { get: (t: unknown) => { avisarSeguro(p: object): void; esperarPendientes(): Promise<void> } }).get(
        (await import('../../src/notificaciones/avisos-internos/aviso-pedido-modificado.service')).AvisoPedidoModificadoService,
      );
      avisos.avisarSeguro({ tenantId: menudeo.tenant.id, orderId: 'no-importa' });
      await avisos.esperarPendientes();
      expect(llamadas()).toHaveLength(0);
    });
  });
});
