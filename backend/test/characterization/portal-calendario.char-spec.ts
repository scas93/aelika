import request from 'supertest';
import { seedBase } from './db';
import { usarSuite } from './helpers';
import {
  altaClienteB2bDePrueba,
  apiRol,
  cerrarEntregasB2b,
  crearAdminB2b,
} from './b2b-helpers';

// Fase 4 · 4c · GET /portal/calendario y parámetros del calendario del negocio.
// Reloj de la suite: miércoles 2026-09-30 10:00 CDMX. Semana en curso 2026-09-28, siguiente 2026-10-05.
describe('Portal · calendario (4c)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const http = () => request(s.h.app.getHttpServer());
  const H = { 'x-portal-request': '1' };
  const TEL = '3331006915';

  const entorno = { ...process.env };
  beforeEach(() => {
    process.env.PORTAL_CODIGO_EN_LOG = 'true';
    delete process.env.RAILWAY_PROJECT_NAME;
  });
  afterEach(() => {
    process.env = { ...entorno };
  });

  const slug = () => s.base.tenant.slug;
  const cookieDe = (res: request.Response, nombre: string) =>
    ((res.headers['set-cookie'] as unknown as string[]) ?? []).find((c) =>
      c.startsWith(`${nombre}=`),
    );

  /** Entra al portal de `sl` con el teléfono y devuelve el encabezado Cookie. */
  async function entrar(telefono = TEL, sl = slug(), elegir?: string) {
    await http()
      .post('/portal/acceso/pedir-codigo')
      .set(H)
      .send({ slug: sl, telefono })
      .expect(200);
    const llamadas = s.h.fakes.enviarCodigoAcceso.mock.calls;
    const codigo = llamadas[llamadas.length - 1][0].codigo as string;
    const v = await http()
      .post('/portal/acceso/verificar')
      .set(H)
      .send({ slug: sl, telefono, codigo })
      .expect(200);
    const nombre = `__Host-portal_${sl}`;
    const token = (cookieDe(v, nombre) as string).split(';')[0].split('=')[1];
    const cookie = `${nombre}=${token}`;
    if (elegir)
      await http()
        .post('/portal/acceso/cliente')
        .set(H)
        .set('Cookie', cookie)
        .send({ slug: sl, clienteId: elegir })
        .expect(200);
    return cookie;
  }
  const calendario = (cookie: string, sl = slug()) =>
    http().get(`/portal/calendario?slug=${sl}`).set('Cookie', cookie);

  const alta = (telefono = TEL, extra: Record<string, unknown> = {}) =>
    altaClienteB2bDePrueba(s.h, s.base, {
      contactoTelefono: telefono,
      ...extra,
    });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  const pedido = (clienteId: string, semanaInicio: string, dias: string[]) =>
    crearAdminB2b(s.h, s.base, {
      clienteId,
      semanaInicio,
      items: [
        {
          productId: s.base.productoA.id,
          distribucion: dias.map((dia) => ({ dia, cantidad: 10 })),
        },
      ],
    });
  const diaDe = (body: any, fecha: string) => {
    for (const sem of body.semanas) {
      const d = sem.dias.find((x: any) => x.fecha === fecha);
      if (d) return d;
    }
    throw new Error(`sin día ${fecha}`);
  };
  const ajustar = (data: Record<string, unknown>) =>
    s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data });

  describe('acceso al endpoint', () => {
    it('sin sesión → 401', async () => {
      await alta();
      await http().get(`/portal/calendario?slug=${slug()}`).expect(401);
    });

    it('con cookie inválida → 401 y la borra', async () => {
      const r = await calendario(`__Host-portal_${slug()}=no-existe`).expect(
        401,
      );
      expect(cookieDe(r, `__Host-portal_${slug()}`)).toMatch(
        /Expires=Thu, 01 Jan 1970/i,
      );
    });

    it('teléfono en varios clientes sin elegir → 409; ya elegido → 200', async () => {
      const a = await alta(TEL, { negocioNombre: 'Sucursal Centro' });
      await alta(TEL, { negocioNombre: 'Sucursal Norte' });
      const cookie = await entrar();
      await calendario(cookie).expect(409);
      const r = await http()
        .post('/portal/acceso/cliente')
        .set(H)
        .set('Cookie', cookie)
        .send({ slug: slug(), clienteId: a.id });
      expect(r.status).toBe(200);
      const c = await calendario(cookie).expect(200);
      expect(c.body.cliente.id).toBe(a.id);
    });
  });

  describe('calendario base (parámetros por default)', () => {
    it('semanas del horizonte, parámetros y estado de cada día', async () => {
      await alta();
      const cookie = await entrar();
      const r = await calendario(cookie).expect(200);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.body).toMatchObject({
        ahora: '2026-09-30T16:00:00.000Z',
        zonaHoraria: 'America/Mexico_City',
        horaEntrega: '08:00',
        horasAgregar: 36,
        horasModificar: 18,
        horizonteSemanas: 1,
        numeroAtencion: null,
        pedidosActivos: 0,
        maximoActivos: 2,
      });
      expect(
        r.body.semanas.map((x: any) => [
          x.semanaInicio,
          x.semanaFin,
          x.esActual,
        ]),
      ).toEqual([
        ['2026-09-28', '2026-10-04', true],
        ['2026-10-05', '2026-10-11', false],
      ]);
      expect(
        r.body.semanas.every((x: any) => x.pedido === null && x.puedeCrear),
      ).toBe(true);

      expect(diaDe(r.body, '2026-09-29')).toMatchObject({
        estado: 'NO_DISPONIBLE',
        motivo: 'PASADO',
        diaSemana: 'MARTES',
      });
      expect(diaDe(r.body, '2026-09-30')).toMatchObject({
        estado: 'NO_DISPONIBLE',
        motivo: 'PASADO',
      });
      expect(diaDe(r.body, '2026-10-01')).toMatchObject({
        estado: 'NO_DISPONIBLE',
        motivo: 'ANTICIPACION_AGREGAR',
        entregaAt: '2026-10-01T14:00:00.000Z',
        limiteAt: '2026-09-30T02:00:00.000Z',
      });
      expect(diaDe(r.body, '2026-10-02')).toMatchObject({
        estado: 'AGREGABLE',
        accion: 'CREAR_PEDIDO',
        limiteAt: '2026-10-01T02:00:00.000Z',
      });
      expect(diaDe(r.body, '2026-10-11')).toMatchObject({
        estado: 'AGREGABLE',
        diaSemana: 'DOMINGO',
      });
    });

    it('borde exacto de las 36 h por el endpoint', async () => {
      await alta();
      const cookie = await entrar();
      jest.setSystemTime(new Date('2026-10-01T02:00:00.000Z')); // viernes 08:00 CDMX menos 36 h
      expect(
        diaDe((await calendario(cookie).expect(200)).body, '2026-10-02').estado,
      ).toBe('AGREGABLE');
      jest.setSystemTime(new Date('2026-10-01T02:00:00.001Z'));
      expect(
        diaDe((await calendario(cookie).expect(200)).body, '2026-10-02').estado,
      ).toBe('NO_DISPONIBLE');
    });

    it('cambio de semana: el domingo 23:59 CDMX sigue la semana del 28; el lunes 00:00 empieza la del 5', async () => {
      await alta();
      const cookie = await entrar();
      jest.setSystemTime(new Date('2026-10-05T05:59:00.000Z'));
      expect(
        (await calendario(cookie).expect(200)).body.semanas.map(
          (x: any) => x.semanaInicio,
        ),
      ).toEqual(['2026-09-28', '2026-10-05']);
      jest.setSystemTime(new Date('2026-10-05T06:00:00.000Z'));
      const r = await calendario(cookie).expect(200);
      expect(
        r.body.semanas.map((x: any) => [x.semanaInicio, x.esActual]),
      ).toEqual([
        ['2026-10-05', true],
        ['2026-10-12', false],
      ]);
    });
  });

  describe('parámetros del negocio', () => {
    it('hora de entrega, horas límite y horizonte propios', async () => {
      await alta();
      const cookie = await entrar();
      await ajustar({
        portalHoraEntrega: '18:30',
        portalHorasAgregarDia: 24,
        portalHorasModificar: 6,
        portalHorizonteSemanas: 2,
        numeroAtencion: '5512345678',
      });
      const r = await calendario(cookie).expect(200);
      expect(r.body).toMatchObject({
        horaEntrega: '18:30',
        horasAgregar: 24,
        horasModificar: 6,
        horizonteSemanas: 2,
        maximoActivos: 3,
        numeroAtencion: '5512345678',
      });
      expect(r.body.semanas).toHaveLength(3);
      // Jueves 18:30 CDMX = viernes 00:30Z; límite = jueves 00:30Z (miércoles 18:30 CDMX).
      expect(diaDe(r.body, '2026-10-01')).toMatchObject({
        estado: 'AGREGABLE',
        entregaAt: '2026-10-02T00:30:00.000Z',
        limiteAt: '2026-10-01T00:30:00.000Z',
      });
    });

    it('horizonte 0: solo la semana en curso', async () => {
      await alta();
      const cookie = await entrar();
      await ajustar({ portalHorizonteSemanas: 0 });
      const r = await calendario(cookie).expect(200);
      expect(r.body.semanas).toHaveLength(1);
      expect(r.body.maximoActivos).toBe(1);
    });

    it('forzar que un día quede cerrado: más horas para modificar que la anticipación disponible', async () => {
      const c = await alta();
      await pedido(c.id, '2026-10-05', ['MIERCOLES']);
      const cookie = await entrar();
      expect(
        diaDe((await calendario(cookie).expect(200)).body, '2026-10-07').estado,
      ).toBe('MODIFICABLE');
      await ajustar({ portalHorasModificar: 168 }); // 7 días: el miércoles 7 (a ~6 días) ya queda cerrado
      expect(
        diaDe((await calendario(cookie).expect(200)).body, '2026-10-07'),
      ).toMatchObject({
        estado: 'CERRADO',
        motivo: 'ANTICIPACION_MODIFICAR',
      });
    });
  });

  describe('pedido del cliente', () => {
    it('pedido existente: sus días son modificables, los demás se agregan a ese pedido; no puede crear otro', async () => {
      const c = await alta();
      const p = await pedido(c.id, '2026-10-05', ['LUNES', 'MIERCOLES']);
      const cookie = await entrar();
      const r = await calendario(cookie).expect(200);
      const sem = r.body.semanas[1];
      expect(sem.pedido).toEqual({
        folio: p.folio,
        estado: 'PENDIENTE_CONFIRMACION',
        pagado: false,
        activo: true,
      });
      expect(sem.puedeCrear).toBe(false);
      expect(r.body.semanas[0].puedeCrear).toBe(true);
      expect(diaDe(r.body, '2026-10-05')).toMatchObject({
        estado: 'MODIFICABLE',
        entrega: { estado: 'PENDIENTE' },
        limiteAt: '2026-10-04T20:00:00.000Z', // lunes 08:00 CDMX menos 18 h
      });
      expect(diaDe(r.body, '2026-10-06')).toMatchObject({
        estado: 'AGREGABLE',
        accion: 'AGREGAR_A_PEDIDO',
      });
      expect(r.body.pedidosActivos).toBe(1);
    });

    it('entrega a menos de 18 h: cerrada; entre 18 y 36 h: modificable pero no agregable', async () => {
      const c = await alta();
      await pedido(c.id, '2026-09-28', ['JUEVES', 'VIERNES']);
      const cookie = await entrar();
      // Miércoles 10:00: el jueves 08:00 está a 22 h (modificable) y el viernes a 46 h.
      let r = await calendario(cookie).expect(200);
      expect(diaDe(r.body, '2026-10-01').estado).toBe('MODIFICABLE');
      // Miércoles 20:00 CDMX: el jueves queda a 12 h → cerrado.
      jest.setSystemTime(new Date('2026-10-01T02:00:00.000Z'));
      r = await calendario(cookie).expect(200);
      expect(diaDe(r.body, '2026-10-01')).toMatchObject({
        estado: 'CERRADO',
        motivo: 'ANTICIPACION_MODIFICAR',
      });
      expect(diaDe(r.body, '2026-10-02').estado).toBe('MODIFICABLE');
    });

    it('entrega ya cerrada (Entregada) → CERRADO con ENTREGA_CERRADA', async () => {
      const c = await alta();
      const p = await pedido(c.id, '2026-10-05', ['LUNES', 'MARTES']);
      const api = dueno();
      await api.patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
      const detalle = await api.get(`/pedidos-b2b/${p.id}`).expect(200);
      const lunes = detalle.body.entregas.find((e: any) =>
        e.fecha.startsWith('2026-10-05'),
      );
      await api
        .patch(`/pedidos-b2b/${p.id}/entregas/${lunes.id}/cerrar`)
        .send({ estado: 'ENTREGADA' })
        .expect(200);
      const cookie = await entrar();
      const r = await calendario(cookie).expect(200);
      expect(diaDe(r.body, '2026-10-05')).toMatchObject({
        estado: 'CERRADO',
        motivo: 'ENTREGA_CERRADA',
      });
      expect(diaDe(r.body, '2026-10-06').estado).toBe('MODIFICABLE');
      expect(r.body.semanas[1].pedido.estado).toBe('EN_PROCESO');
    });

    it('pedido Pagado: toda su semana CERRADO con PEDIDO_PAGADO; la otra semana sigue igual', async () => {
      const c = await alta();
      const p = await pedido(c.id, '2026-10-05', ['LUNES', 'MIERCOLES']);
      await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      const cookie = await entrar();
      const r = await calendario(cookie).expect(200);
      const sem = r.body.semanas[1];
      expect(sem.pedido.pagado).toBe(true);
      expect(sem.dias).toHaveLength(7);
      expect(
        sem.dias.every(
          (d: any) =>
            d.estado === 'CERRADO' &&
            d.motivo === 'PEDIDO_PAGADO' &&
            d.accion === null,
        ),
      ).toBe(true);
      expect(sem.puedeCrear).toBe(false);
      // Días con y sin entrega: ambos cerrados por el pago.
      expect(diaDe(r.body, '2026-10-05').entrega).toEqual({
        estado: 'PENDIENTE',
      });
      expect(diaDe(r.body, '2026-10-06').entrega).toBeNull();
      expect(r.body.semanas[0].puedeCrear).toBe(true);
      expect(diaDe(r.body, '2026-10-02').estado).toBe('AGREGABLE');
    });

    it('pedido cancelado: no cuenta (la semana vuelve a poder tener pedido)', async () => {
      const c = await alta();
      const p = await pedido(c.id, '2026-10-05', ['LUNES']);
      await dueno().patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200);
      const cookie = await entrar();
      const r = await calendario(cookie).expect(200);
      expect(r.body.semanas[1].pedido).toBeNull();
      expect(r.body.semanas[1].puedeCrear).toBe(true);
      expect(r.body.pedidosActivos).toBe(0);
      expect(diaDe(r.body, '2026-10-05').entrega).toBeNull();
    });

    it('límite de activos: dos pedidos (semana en curso y siguiente) → 2 de 2; un Completado no cuenta', async () => {
      const c = await alta();
      await pedido(c.id, '2026-09-28', ['VIERNES']);
      const p2 = await pedido(c.id, '2026-10-05', ['LUNES']);
      const cookie = await entrar();
      let r = await calendario(cookie).expect(200);
      expect(r.body).toMatchObject({ pedidosActivos: 2, maximoActivos: 2 });
      expect(r.body.semanas.every((x: any) => x.pedido && !x.puedeCrear)).toBe(
        true,
      );

      // El de la semana siguiente se completa: deja de ser activo, pero sigue ocupando su semana.
      const api = dueno();
      await api.patch(`/pedidos-b2b/${p2.id}/avanzar`).expect(200);
      await cerrarEntregasB2b(api, p2.id);
      r = await calendario(cookie).expect(200);
      expect(r.body.pedidosActivos).toBe(1);
      expect(r.body.semanas[1].pedido).toMatchObject({
        estado: 'COMPLETADO',
        activo: false,
      });
      expect(r.body.semanas[1].puedeCrear).toBe(false);
    });

    it('un pedido activo de una semana anterior cuenta para los activos aunque no salga en el horizonte', async () => {
      const c = await alta();
      await pedido(c.id, '2026-09-21', ['LUNES']);
      const cookie = await entrar();
      const r = await calendario(cookie).expect(200);
      expect(r.body.pedidosActivos).toBe(1);
      expect(r.body.semanas.map((x: any) => x.semanaInicio)).toEqual([
        '2026-09-28',
        '2026-10-05',
      ]);
    });
  });

  describe('aislamiento', () => {
    it('el calendario de un cliente no ve pedidos de otro cliente del mismo negocio ni de otro negocio', async () => {
      const a = await alta(TEL, { negocioNombre: 'Cafetería Centro' });
      const b = await alta('5511112222', { negocioNombre: 'Cafetería Norte' });
      await pedido(b.id, '2026-10-05', ['LUNES', 'MARTES']);

      // Mismo teléfono en otro negocio con parámetros distintos y un pedido propio.
      const otro = await seedBase(s.h.prisma, {
        slug: 'otro-mayoreo',
        tipoStorefront: 'RETAIL_B2B',
      });
      await s.h.prisma.tenant.update({
        where: { id: otro.tenant.id },
        data: {
          portalHoraEntrega: '20:00',
          portalHorasAgregarDia: 72,
          numeroAtencion: '5599999999',
        },
      });
      const ajeno = await altaClienteB2bDePrueba(s.h, otro, {
        contactoTelefono: TEL,
      });
      await crearAdminB2b(s.h, otro, {
        clienteId: ajeno.id,
        semanaInicio: '2026-10-05',
        items: [
          {
            productId: otro.productoA.id,
            distribucion: [{ dia: 'JUEVES', cantidad: 2 }],
          },
        ],
      });

      const cookieA = await entrar(TEL, slug());
      const rA = await calendario(cookieA).expect(200);
      expect(rA.body.cliente.id).toBe(a.id);
      expect(rA.body.semanas.every((x: any) => x.pedido === null)).toBe(true);
      expect(rA.body).toMatchObject({
        horaEntrega: '08:00',
        horasAgregar: 36,
        numeroAtencion: null,
        pedidosActivos: 0,
      });

      const cookieOtro = await entrar(TEL, otro.tenant.slug);
      const rO = await calendario(cookieOtro, otro.tenant.slug).expect(200);
      expect(rO.body).toMatchObject({
        horaEntrega: '20:00',
        horasAgregar: 72,
        numeroAtencion: '5599999999',
      });
      expect(rO.body.semanas[1].pedido).not.toBeNull();
      expect(rO.body.cliente.id).toBe(ajeno.id);

      // La cookie de un negocio no sirve para consultar el calendario del otro.
      await calendario(cookieA, otro.tenant.slug).expect(401);
    });
  });

  describe('parámetros en Ajustes (PATCH /tenant/me)', () => {
    it('GET devuelve los defaults', async () => {
      const r = await dueno().get('/tenant/me').expect(200);
      expect(r.body).toMatchObject({
        portalHoraEntrega: '08:00',
        portalHorasAgregarDia: 36,
        portalHorasModificar: 18,
        portalHorizonteSemanas: 1,
        numeroAtencion: null,
      });
    });

    it('guarda y devuelve los valores; el número de atención se normaliza', async () => {
      const r = await dueno()
        .patch('/tenant/me')
        .send({
          portalHoraEntrega: '07:30',
          portalHorasAgregarDia: 48,
          portalHorasModificar: 12,
          portalHorizonteSemanas: 3,
          numeroAtencion: '+52 (333) 100-6915',
        })
        .expect(200);
      expect(r.body).toMatchObject({
        portalHoraEntrega: '07:30',
        portalHorasAgregarDia: 48,
        portalHorasModificar: 12,
        portalHorizonteSemanas: 3,
        numeroAtencion: '3331006915',
      });
    });

    it('número vacío lo quita; un parámetro omitido no se toca', async () => {
      await dueno()
        .patch('/tenant/me')
        .send({ numeroAtencion: '3331006915', portalHorasModificar: 10 })
        .expect(200);
      const r = await dueno()
        .patch('/tenant/me')
        .send({ numeroAtencion: '' })
        .expect(200);
      expect(r.body.numeroAtencion).toBeNull();
      expect(r.body.portalHorasModificar).toBe(10);
      const n = await dueno()
        .patch('/tenant/me')
        .send({ numeroAtencion: null })
        .expect(200);
      expect(n.body.numeroAtencion).toBeNull();
    });

    it.each([
      [{ portalHoraEntrega: '25:00' }],
      [{ portalHoraEntrega: '8am' }],
      [{ portalHorasAgregarDia: -1 }],
      [{ portalHorasAgregarDia: 169 }],
      [{ portalHorasAgregarDia: 1.5 }],
      [{ portalHorasModificar: 200 }],
      [{ portalHorizonteSemanas: 5 }],
      [{ portalHorizonteSemanas: -1 }],
      [{ numeroAtencion: '12345' }],
      [{ numeroAtencion: '33310069151234' }],
    ])('rechaza %j con 400', async (cuerpo) => {
      await dueno().patch('/tenant/me').send(cuerpo).expect(400);
    });

    it('solo el Dueño: el Gerente y el Operador reciben 403', async () => {
      await apiRol(s.h, s.base, 'GERENTE')
        .patch('/tenant/me')
        .send({ portalHorasModificar: 10 })
        .expect(403);
      await apiRol(s.h, s.base, 'OPERADOR')
        .patch('/tenant/me')
        .send({ portalHorasModificar: 10 })
        .expect(403);
    });
  });
});
