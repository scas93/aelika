import request from 'supertest';
import { seedBase } from './db';
import { usarSuite } from './helpers';
import { altaClienteB2bDePrueba, apiRol, crearAdminB2b } from './b2b-helpers';

// Fase 4 · 4d · catálogo con sesión, creación de pedidos (una y dos semanas, atómica), idempotencia y favorito.
// Reloj de la suite: miércoles 2026-09-30 10:00 CDMX. Semana en curso 2026-09-28, siguiente 2026-10-05. Entrega 08:00, 36 h.
describe('Portal · crear pedido (4d)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const http = () => request(s.h.app.getHttpServer());
  const H = { 'x-portal-request': '1' };
  const TEL = '3331006915';
  const MENSAJE_YA =
    'Ya tienes pedido para esta semana. Para agregar o cambiar entregas, usa Modificar pedido activo';
  let idem = 0;
  const llave = () => `llave-prueba-${String(++idem).padStart(6, '0')}`;

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
    const cookie = `${nombre}=${(cookieDe(v, nombre) as string).split(';')[0].split('=')[1]}`;
    if (elegir)
      await http()
        .post('/portal/acceso/cliente')
        .set(H)
        .set('Cookie', cookie)
        .send({ slug: sl, clienteId: elegir })
        .expect(200);
    return cookie;
  }
  const alta = (telefono = TEL, extra: Record<string, unknown> = {}) =>
    altaClienteB2bDePrueba(s.h, s.base, {
      contactoTelefono: telefono,
      ...extra,
    });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  const ajustarMinimo = (n: number) =>
    s.h.prisma.tenant.update({
      where: { id: s.base.tenant.id },
      data: { pedidoB2bMinimoPiezas: n },
    });

  const A = () => s.base.productoA.id; // Café americano $45
  const B = () => s.base.productoB.id; // Concha $30.50
  type Entrega = {
    fecha: string;
    items: { productId: string; cantidad: number }[];
  };
  const e = (fecha: string, ...items: [string, number][]): Entrega => ({
    fecha,
    items: items.map(([productId, cantidad]) => ({ productId, cantidad })),
  });
  const crear = (
    cookie: string,
    entregas: Entrega[],
    extra: Record<string, unknown> = {},
    key: string | null = llave(),
  ) => {
    let r = http().post('/portal/pedidos').set(H).set('Cookie', cookie);
    if (key) r = r.set('Idempotency-Key', key);
    return r.send({ slug: slug(), entregas, ...extra });
  };
  const ordenes = () =>
    s.h.prisma.order.findMany({
      where: { tipo: 'B2B' },
      orderBy: { folio: 'asc' },
    });

  // ------------------------------------------------------------------ catálogo
  describe('GET /portal/catalogo', () => {
    it('sin sesión → 401', async () => {
      await http().get(`/portal/catalogo?slug=${slug()}`).expect(401);
    });

    it('con sesión: productos disponibles con precio de lista, % del cliente y mínimo; sin datos internos', async () => {
      const c = await alta(TEL, { descuentoPorcentaje: 10 });
      await s.h.prisma.product.update({
        where: { id: B() },
        data: { disponible: false },
      });
      const extra = await s.h.prisma.category.create({
        data: { tenantId: s.base.tenant.id, nombre: 'Oculta', activa: false },
      });
      await s.h.prisma.product.create({
        data: {
          tenantId: s.base.tenant.id,
          categoryId: extra.id,
          nombre: 'Fantasma',
          precio: '1.00',
        },
      });
      await s.h.prisma.product.update({
        where: { id: A() },
        data: { erpId: 'ERP-A1' },
      });
      const cookie = await entrar();
      const r = await http()
        .get(`/portal/catalogo?slug=${slug()}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.body).toEqual({
        cliente: { id: c.id, nombre: 'Cafetería La Esquina' },
        descuentoPorcentaje: 10,
        minimoPiezas: 10,
        categories: [
          {
            id: s.base.categoria.id,
            nombre: 'Bebidas',
            products: [
              {
                id: A(),
                nombre: 'Café americano',
                descripcion: null,
                precio: 45,
                fotoUrl: null,
              },
            ],
          },
        ],
      });
      expect(JSON.stringify(r.body)).not.toContain('ERP-A1');
    });

    it('un cliente sin descuento recibe 0; el precio es el vigente del catálogo', async () => {
      await alta();
      await s.h.prisma.product.update({
        where: { id: A() },
        data: { precio: '52.00' },
      });
      const cookie = await entrar();
      const r = await http()
        .get(`/portal/catalogo?slug=${slug()}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(r.body.descuentoPorcentaje).toBe(0);
      expect(
        r.body.categories[0].products.find((p: any) => p.id === A()).precio,
      ).toBe(52);
    });

    it('teléfono en varios clientes sin elegir → 409', async () => {
      await alta(TEL, { negocioNombre: 'Sucursal Centro' });
      await alta(TEL, { negocioNombre: 'Sucursal Norte' });
      const cookie = await entrar();
      await http()
        .get(`/portal/catalogo?slug=${slug()}`)
        .set('Cookie', cookie)
        .expect(409);
    });
  });

  // ------------------------------------------------------------------ crear
  describe('POST /portal/pedidos · una semana', () => {
    it('crea el pedido del cliente de la sesión con descuento, precios vigentes y snapshots', async () => {
      const c = await alta(TEL, {
        descuentoPorcentaje: 10,
        modalidadPago: 'AL_INICIO',
      });
      await s.h.prisma.product.update({
        where: { id: A() },
        data: { precio: '50.00' },
      });
      const cookie = await entrar();
      const r = await crear(
        cookie,
        [
          e('2026-10-05', [A(), 5], [B(), 2]),
          e('2026-10-07', [A(), 3], [B(), 2]),
        ],
        {
          notaCliente: '  Sin azúcar  ',
        },
      ).expect(201);

      // 8 × $50 + 4 × $30.50 = $522; 10 % = $52.20; total $469.80
      expect(r.body.pedidos).toHaveLength(1);
      expect(r.body.pedidos[0]).toMatchObject({
        folio: 'P-000001',
        semanaInicio: '2026-10-05',
        semanaFin: '2026-10-11',
        estado: 'PENDIENTE_CONFIRMACION',
        totalPiezas: 12,
        subtotal: 522,
        descuentoPorcentaje: 10,
        descuentoTotal: 52.2,
        total: 469.8,
      });
      expect(r.body.total).toBe(469.8);
      expect(r.body.pedidos[0].entregas.map((x: any) => x.fecha)).toEqual([
        '2026-10-05',
        '2026-10-07',
      ]);
      expect(r.body.pedidos[0].entregas[0].productos).toEqual([
        {
          nombre: 'Café americano',
          cantidad: 5,
          precioUnitario: 50,
          subtotal: 250,
        },
        { nombre: 'Concha', cantidad: 2, precioUnitario: 30.5, subtotal: 61 },
      ]);
      // La respuesta no trae ids internos.
      expect(JSON.stringify(r.body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);

      const [orden] = await ordenes();
      expect(orden).toMatchObject({
        clienteId: c.id,
        tenantId: s.base.tenant.id,
        folio: 'P-000001',
        estadoPedido: 'PENDIENTE_CONFIRMACION',
        estadoPago: 'PENDIENTE',
        cancelado: false,
      });
      const det = await s.h.prisma.detalleB2B.findFirstOrThrow({
        where: { orderId: orden.id },
      });
      expect(det).toMatchObject({
        negocioNombre: 'Cafetería La Esquina',
        modoCobro: 'AL_INICIO',
        minimoPiezasAplicado: 10,
        totalPiezas: 12,
        notaCliente: 'Sin azúcar',
      });
      expect(Number(det.subtotal)).toBe(522);
      expect(Number(det.descuentoPorcentajeAplicado)).toBe(10);
      expect(det.semanaInicio.toISOString().slice(0, 10)).toBe('2026-10-05');
      const entregas = await s.h.prisma.entrega.findMany({
        where: { orderId: orden.id },
        orderBy: { fecha: 'asc' },
      });
      expect(
        entregas.map((x) => [x.fecha.toISOString().slice(0, 10), x.estado]),
      ).toEqual([
        ['2026-10-05', 'PENDIENTE'],
        ['2026-10-07', 'PENDIENTE'],
      ]);
    });

    it('el cliente es el de la sesión: un clienteId o precios en el cuerpo se ignoran', async () => {
      const c = await alta();
      const otro = await alta('5511112222', {
        negocioNombre: 'Cafetería Norte',
      });
      const cookie = await entrar();
      const r = await crear(cookie, [e('2026-10-05', [A(), 12])], {
        clienteId: otro.id,
        descuentoPorcentaje: 90,
        total: 1,
        precio: 0,
      }).expect(201);
      expect(r.body.pedidos[0].total).toBe(540);
      const [orden] = await ordenes();
      expect(orden.clienteId).toBe(c.id);
    });

    it('un producto repetido en la misma entrega se suma', async () => {
      await alta();
      const cookie = await entrar();
      const r = await crear(cookie, [
        e('2026-10-05', [A(), 6], [A(), 6]),
      ]).expect(201);
      expect(r.body.pedidos[0].totalPiezas).toBe(12);
    });
  });

  describe('POST /portal/pedidos · dos semanas (atómico)', () => {
    it('crea un pedido por semana en una sola operación, con folios consecutivos', async () => {
      await alta();
      const cookie = await entrar();
      const r = await crear(
        cookie,
        [
          e('2026-10-02', [A(), 6]),
          e('2026-10-04', [A(), 6]),
          e('2026-10-06', [B(), 12]),
        ],
        { notaCliente: 'Gracias' },
      ).expect(201);
      expect(
        r.body.pedidos.map((p: any) => [
          p.folio,
          p.semanaInicio,
          p.totalPiezas,
        ]),
      ).toEqual([
        ['P-000001', '2026-09-28', 12],
        ['P-000002', '2026-10-05', 12],
      ]);
      expect(r.body.total).toBe(540 + 366);
      expect((await ordenes()).length).toBe(2);
      const dets = await s.h.prisma.detalleB2B.findMany({
        orderBy: { semanaInicio: 'asc' },
      });
      expect(dets.map((d) => d.notaCliente)).toEqual(['Gracias', 'Gracias']);
    });

    it('todo o nada: si una semana no cumple el mínimo no se crea ninguna y no se gasta folio', async () => {
      await alta();
      const cookie = await entrar();
      const r = await crear(cookie, [
        e('2026-10-02', [A(), 12]),
        e('2026-10-06', [A(), 2]),
      ]).expect(409);
      expect(r.body.message).toMatch(
        /necesita al menos 10 piezas \(llevas 2\)/,
      );
      expect(await s.h.prisma.order.count()).toBe(0);
      expect(await s.h.prisma.entrega.count()).toBe(0);
      // Los folios no se consumieron.
      const ok = await crear(cookie, [e('2026-10-05', [A(), 12])]).expect(201);
      expect(ok.body.pedidos[0].folio).toBe('P-000001');
    });

    it('si la segunda semana ya tiene pedido, tampoco se crea la primera', async () => {
      const c = await alta();
      await crearAdminB2b(s.h, s.base, {
        clienteId: c.id,
        semanaInicio: '2026-10-05',
        items: [
          { productId: A(), distribucion: [{ dia: 'LUNES', cantidad: 12 }] },
        ],
      });
      const cookie = await entrar();
      const antes = await s.h.prisma.order.count();
      const r = await crear(cookie, [
        e('2026-10-02', [A(), 12]),
        e('2026-10-06', [A(), 12]),
      ]).expect(409);
      expect(r.body.fechas).toEqual([
        {
          fecha: '2026-10-06',
          motivo: 'SEMANA_CON_PEDIDO',
          mensaje: MENSAJE_YA,
        },
      ]);
      expect(await s.h.prisma.order.count()).toBe(antes);
    });
  });

  describe('POST /portal/pedidos · reglas del calendario', () => {
    it('semana que ya tiene pedido → 409 con el mensaje del diseño', async () => {
      const c = await alta();
      await crearAdminB2b(s.h, s.base, {
        clienteId: c.id,
        semanaInicio: '2026-10-05',
        items: [
          { productId: A(), distribucion: [{ dia: 'LUNES', cantidad: 12 }] },
        ],
      });
      const cookie = await entrar();
      const r = await crear(cookie, [e('2026-10-08', [A(), 12])]).expect(409);
      expect(r.body.message).toBe(MENSAJE_YA);
    });

    it('semana con pedido Pagado → 409 (toda su semana está cerrada)', async () => {
      const c = await alta();
      const p = await crearAdminB2b(s.h, s.base, {
        clienteId: c.id,
        semanaInicio: '2026-10-05',
        items: [
          { productId: A(), distribucion: [{ dia: 'LUNES', cantidad: 12 }] },
        ],
      });
      await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      const cookie = await entrar();
      const r = await crear(cookie, [e('2026-10-09', [A(), 12])]).expect(409);
      expect(r.body.fechas[0].motivo).toBe('SEMANA_CON_PEDIDO');
    });

    it('menos de 36 h, día pasado y fuera del horizonte: 409 con una lista legible', async () => {
      await alta();
      const cookie = await entrar();
      const r = await crear(cookie, [
        e('2026-10-01', [A(), 4]), // jueves 08:00: a 22 h
        e('2026-09-29', [A(), 4]), // ya pasó
        e('2026-10-20', [A(), 4]), // fuera del horizonte
      ]).expect(409);
      // En el orden en que se mandaron las fechas.
      expect(r.body.fechas.map((f: any) => [f.fecha, f.motivo])).toEqual([
        ['2026-10-01', 'ANTICIPACION_AGREGAR'],
        ['2026-09-29', 'PASADO'],
        ['2026-10-20', 'FUERA_DEL_CALENDARIO'],
      ]);
      expect(r.body.fechas[0].mensaje).toMatch(
        /se necesitan al menos 36 horas/,
      );
      expect(await s.h.prisma.order.count()).toBe(0);
    });

    it('borde exacto: justo a 36 h sí, un milisegundo después no', async () => {
      await alta();
      const cookie = await entrar();
      jest.setSystemTime(new Date('2026-10-01T02:00:00.001Z')); // viernes 08:00 CDMX menos 36 h, + 1 ms
      await crear(cookie, [e('2026-10-02', [A(), 12])]).expect(409);
      jest.setSystemTime(new Date('2026-10-01T02:00:00.000Z'));
      await crear(cookie, [e('2026-10-02', [A(), 12])]).expect(201);
    });

    it('respeta los parámetros del negocio (horas para pedir y hora de entrega)', async () => {
      await alta();
      const cookie = await entrar();
      await s.h.prisma.tenant.update({
        where: { id: s.base.tenant.id },
        data: { portalHorasAgregarDia: 12, portalHoraEntrega: '07:00' },
      });
      // Jueves 07:00 CDMX está a 21 h: con 12 h de anticipación ya se puede.
      await crear(cookie, [e('2026-10-01', [A(), 12])]).expect(201);
    });

    it('mínimo de piezas del negocio: se rechaza por debajo y se permite en 0', async () => {
      await alta();
      const cookie = await entrar();
      const r = await crear(cookie, [e('2026-10-05', [A(), 9])]).expect(409);
      expect(r.body.message).toMatch(/al menos 10 piezas \(llevas 9\)/);
      await ajustarMinimo(0);
      await crear(cookie, [e('2026-10-05', [A(), 1])]).expect(201);
    });

    it('producto no disponible o de otro negocio → 409 sin crear nada', async () => {
      await alta();
      await ajustarMinimo(0);
      const cookie = await entrar();
      await s.h.prisma.product.update({
        where: { id: B() },
        data: { disponible: false },
      });
      await crear(cookie, [e('2026-10-05', [A(), 6], [B(), 6])]).expect(409);
      const otro = await seedBase(s.h.prisma, {
        slug: 'otro-mayoreo',
        tipoStorefront: 'RETAIL_B2B',
      });
      await crear(cookie, [e('2026-10-05', [otro.productoA.id, 12])]).expect(
        409,
      );
      expect(await s.h.prisma.order.count()).toBe(0);
    });
  });

  describe('POST /portal/pedidos · validación y acceso', () => {
    it('sin sesión → 401; sin encabezado del portal → 400; cuerpo inválido → 400; llave inválida → 400', async () => {
      await alta();
      await http()
        .post('/portal/pedidos')
        .set(H)
        .send({ slug: slug(), entregas: [e('2026-10-05', [A(), 12])] })
        .expect(401);
      const cookie = await entrar();
      await http()
        .post('/portal/pedidos')
        .set('Cookie', cookie)
        .send({ slug: slug(), entregas: [e('2026-10-05', [A(), 12])] })
        .expect(400);
      await crear(cookie, []).expect(400);
      await crear(cookie, [e('2026-10-05')]).expect(400);
      await crear(cookie, [e('2026-10-05', [A(), 0])]).expect(400); // entrega sin ningún producto con cantidad
      await crear(cookie, [
        e('2026-10-05', [A(), 6]),
        e('2026-10-05', [B(), 6]),
      ]).expect(400); // fecha repetida
      await crear(cookie, [
        { fecha: '05/10/2026', items: [{ productId: A(), cantidad: 1 }] },
      ]).expect(400);
      await crear(cookie, [e('2026-10-05', [A(), 12])], {}, 'corta').expect(
        400,
      );
      expect(await s.h.prisma.order.count()).toBe(0);
    });

    it('teléfono en varios clientes sin elegir → 409', async () => {
      await alta(TEL, { negocioNombre: 'Sucursal Centro' });
      await alta(TEL, { negocioNombre: 'Sucursal Norte' });
      const cookie = await entrar();
      await crear(cookie, [e('2026-10-05', [A(), 12])]).expect(409);
    });

    it('la cookie de un negocio no crea pedidos en otro', async () => {
      await alta();
      const otro = await seedBase(s.h.prisma, {
        slug: 'otro-mayoreo',
        tipoStorefront: 'RETAIL_B2B',
      });
      const cookie = await entrar();
      const token = cookie.split('=')[1];
      await http()
        .post('/portal/pedidos')
        .set(H)
        .set('Cookie', `__Host-portal_${otro.tenant.slug}=${token}`)
        .send({
          slug: otro.tenant.slug,
          entregas: [e('2026-10-05', [otro.productoA.id, 12])],
        })
        .expect(401);
    });

    it('un cliente dado de baja pierde la sesión y no puede crear', async () => {
      const c = await alta();
      const cookie = await entrar();
      await s.h.prisma.cliente.update({
        where: { id: c.id },
        data: { bajaAt: new Date() },
      });
      await crear(cookie, [e('2026-10-05', [A(), 12])]).expect(401);
    });
  });

  describe('idempotencia', () => {
    it('el mismo envío repetido devuelve el mismo resultado y no duplica', async () => {
      await alta();
      const cookie = await entrar();
      const key = llave();
      const uno = await crear(
        cookie,
        [e('2026-10-05', [A(), 12])],
        {},
        key,
      ).expect(201);
      const dos = await crear(
        cookie,
        [e('2026-10-05', [A(), 12])],
        {},
        key,
      ).expect(201);
      expect(dos.body).toEqual(uno.body);
      expect(await s.h.prisma.order.count()).toBe(1);
    });

    it('una llave nueva con la misma semana ya no crea otro (un pedido por semana)', async () => {
      await alta();
      const cookie = await entrar();
      await crear(cookie, [e('2026-10-05', [A(), 12])]).expect(201);
      const r = await crear(cookie, [e('2026-10-05', [A(), 12])]).expect(409);
      expect(r.body.message).toBe(MENSAJE_YA);
      expect(await s.h.prisma.order.count()).toBe(1);
    });

    it('dos envíos simultáneos con la misma llave crean un solo pedido', async () => {
      await alta();
      const cookie = await entrar();
      const key = llave();
      const [a, b] = await Promise.all([
        crear(cookie, [e('2026-10-05', [A(), 12])], {}, key),
        crear(cookie, [e('2026-10-05', [A(), 12])], {}, key),
      ]);
      // El segundo recibe el mismo resultado (201) o «se está procesando» (409); nunca crea otro pedido.
      expect([a.status, b.status].every((x) => x === 201 || x === 409)).toBe(
        true,
      );
      expect([a.status, b.status]).toContain(201);
      expect(await s.h.prisma.order.count()).toBe(1);
    });

    it('sin llave, dos envíos simultáneos tampoco duplican (candado del cliente)', async () => {
      await alta();
      const cookie = await entrar();
      const [a, b] = await Promise.all([
        crear(cookie, [e('2026-10-05', [A(), 12])], {}, null),
        crear(cookie, [e('2026-10-05', [A(), 12])], {}, null),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await s.h.prisma.order.count()).toBe(1);
    });

    it('un envío con llave en curso responde 409 «se está procesando»', async () => {
      const c = await alta();
      const cookie = await entrar();
      const key = llave();
      await s.h.fakes.codigos.reservar(
        `portal:idem:${s.base.tenant.id}:${c.id}:${key}`,
        'EN_CURSO',
        120,
      );
      const r = await crear(
        cookie,
        [e('2026-10-05', [A(), 12])],
        {},
        key,
      ).expect(409);
      expect(r.body.message).toMatch(/se está procesando/);
      expect(await s.h.prisma.order.count()).toBe(0);
    });

    it('si el envío falla, la llave se libera y se puede reintentar', async () => {
      await alta();
      const cookie = await entrar();
      const key = llave();
      await crear(cookie, [e('2026-10-05', [A(), 9])], {}, key).expect(409); // por debajo del mínimo
      await crear(cookie, [e('2026-10-05', [A(), 12])], {}, key).expect(201);
    });

    it('Redis caído: el pedido se crea igual (sin idempotencia) y no se duplica la semana', async () => {
      await alta();
      const cookie = await entrar();
      s.h.fakes.codigos.caido = true;
      // El acceso del portal usa Redis: la sesión ya existe, así que la validación sigue y solo cae la idempotencia.
      await crear(cookie, [e('2026-10-05', [A(), 12])]).expect(201);
      await crear(cookie, [e('2026-10-05', [A(), 12])]).expect(409);
      expect(await s.h.prisma.order.count()).toBe(1);
    });
  });

  describe('notificaciones', () => {
    it('crear un pedido NO dispara ninguna notificación; solo Confirmado la dispara', async () => {
      await alta();
      const cookie = await entrar();
      s.h.fakes.dispararSeguro.mockClear();
      s.h.fakes.queueAdd.mockClear();
      s.h.fakes.reglaEnvio.mockClear();
      const r = await crear(cookie, [e('2026-10-05', [A(), 12])]).expect(201);
      expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();
      expect(s.h.fakes.queueAdd).not.toHaveBeenCalled();
      expect(s.h.fakes.reglaEnvio).not.toHaveBeenCalled();

      // El equipo lo confirma: ese sí es el único evento B2B.
      const orden = await s.h.prisma.order.findFirstOrThrow({
        where: { folio: r.body.pedidos[0].folio },
      });
      await dueno().patch(`/pedidos-b2b/${orden.id}/avanzar`).expect(200);
      expect(s.h.fakes.dispararSeguro).toHaveBeenCalledTimes(1);
      expect(s.h.fakes.dispararSeguro.mock.calls[0][0]).toMatchObject({
        origen: 'PEDIDO_B2B',
        estatus: 'CONFIRMADO_SURTIENDO',
      });
    });
  });

  // ------------------------------------------------------------------ favorito
  describe('favorito', () => {
    const lineas = () => [
      { productId: A(), dias: { LUNES: 6, MIERCOLES: 6 } },
      { productId: B(), dias: { VIERNES: 4 } },
    ];
    const guardar = (cookie: string, l: unknown = lineas()) =>
      http()
        .put('/portal/favorito')
        .set(H)
        .set('Cookie', cookie)
        .send({ slug: slug(), lineas: l });
    const leer = (cookie: string) =>
      http().get(`/portal/favorito?slug=${slug()}`).set('Cookie', cookie);

    it('sin favorito → null; guardar y leer; guardar de nuevo reemplaza (uno por cliente)', async () => {
      const c = await alta();
      const cookie = await entrar();
      expect((await leer(cookie).expect(200)).body).toEqual({
        favorito: null,
        noDisponibles: [],
      });

      const g = await guardar(cookie).expect(200);
      expect(g.body.favorito.lineas).toEqual([
        {
          productId: A(),
          nombre: 'Café americano',
          dias: { LUNES: 6, MIERCOLES: 6 },
        },
        { productId: B(), nombre: 'Concha', dias: { VIERNES: 4 } },
      ]);
      const l = await leer(cookie).expect(200);
      expect(l.body.favorito.lineas).toHaveLength(2);
      expect(typeof l.body.favorito.guardadoAt).toBe('string');

      await guardar(cookie, [
        { productId: B(), dias: { MARTES: 10, JUEVES: 0 } },
      ]).expect(200);
      const nuevo = await leer(cookie).expect(200);
      expect(nuevo.body.favorito.lineas).toEqual([
        { productId: B(), nombre: 'Concha', dias: { MARTES: 10 } },
      ]);
      const fila = await s.h.prisma.cliente.findUniqueOrThrow({
        where: { id: c.id },
      });
      expect((fila.favoritoB2b as any).lineas).toHaveLength(1); // un solo favorito guardado
    });

    it('sin sesión → 401; sin encabezado → 400; vacío o inválido → 400; producto ajeno → 409', async () => {
      await alta();
      await http().get(`/portal/favorito?slug=${slug()}`).expect(401);
      const cookie = await entrar();
      await http()
        .put('/portal/favorito')
        .set('Cookie', cookie)
        .send({ slug: slug(), lineas: lineas() })
        .expect(400);
      await guardar(cookie, []).expect(400);
      await guardar(cookie, [{ productId: A(), dias: {} }]).expect(400);
      await guardar(cookie, [{ productId: A(), dias: { FERIADO: 3 } }]).expect(
        400,
      );
      await guardar(cookie, [{ productId: A(), dias: { LUNES: -1 } }]).expect(
        400,
      );
      await guardar(cookie, [{ productId: A(), dias: { LUNES: 1.5 } }]).expect(
        400,
      );
      const otro = await seedBase(s.h.prisma, {
        slug: 'otro-mayoreo',
        tipoStorefront: 'RETAIL_B2B',
      });
      await guardar(cookie, [
        { productId: otro.productoA.id, dias: { LUNES: 3 } },
      ]).expect(409);
    });

    it('lo comparten todos los teléfonos del cliente y no lo ve otro cliente', async () => {
      const c = await alta(TEL, { negocioNombre: 'Sucursal Centro' });
      await s.h.prisma.clienteTelefono.create({
        data: {
          tenantId: s.base.tenant.id,
          clienteId: c.id,
          telefono: '5544445555',
        },
      });
      await alta('5511112222', { negocioNombre: 'Sucursal Norte' });
      await guardar(await entrar(TEL)).expect(200);

      const segundoTel = await entrar('5544445555');
      expect(
        (await leer(segundoTel).expect(200)).body.favorito.lineas,
      ).toHaveLength(2);
      const otroCliente = await entrar('5511112222');
      expect((await leer(otroCliente).expect(200)).body.favorito).toBeNull();
    });

    it('un producto que ya no está disponible se quita y se nombra aparte', async () => {
      await alta();
      const cookie = await entrar();
      await guardar(cookie).expect(200);
      await s.h.prisma.product.update({
        where: { id: B() },
        data: { disponible: false },
      });
      const r = await leer(cookie).expect(200);
      expect(r.body.favorito.lineas.map((x: any) => x.nombre)).toEqual([
        'Café americano',
      ]);
      expect(r.body.noDisponibles).toEqual(['Concha']);
    });

    it('no aparece en el directorio de clientes ni en la API de clientes B2B', async () => {
      const c = await alta();
      await guardar(await entrar()).expect(200);
      const lista = await dueno().get('/clientes?canal=B2B').expect(200);
      expect(JSON.stringify(lista.body)).not.toContain('favoritoB2b');
      const det = await dueno().get(`/clientes-b2b/${c.id}`).expect(200);
      expect(JSON.stringify(det.body)).not.toContain('favoritoB2b');
    });

    describe('favorito de un día (PUT /portal/favorito/dia)', () => {
      const guardarDia = (cookie: string, dia: unknown, l: unknown) =>
        http()
          .put('/portal/favorito/dia')
          .set(H)
          .set('Cookie', cookie)
          .send({ slug: slug(), dia, lineas: l });
      const L = (...x: [string, number][]) =>
        x.map(([productId, cantidad]) => ({ productId, cantidad }));

      it('sin favorito lo crea con solo ese día y responde con la forma de GET /portal/favorito', async () => {
        await alta();
        const cookie = await entrar();
        const r = await guardarDia(
          cookie,
          'LUNES',
          L([A(), 6], [B(), 2]),
        ).expect(200);
        expect(Object.keys(r.body).sort()).toEqual([
          'favorito',
          'noDisponibles',
        ]);
        expect(r.body.noDisponibles).toEqual([]);
        expect(typeof r.body.favorito.guardadoAt).toBe('string');
        expect(r.body.favorito.lineas).toEqual([
          { productId: A(), nombre: 'Café americano', dias: { LUNES: 6 } },
          { productId: B(), nombre: 'Concha', dias: { LUNES: 2 } },
        ]);
        expect((await leer(cookie).expect(200)).body).toEqual(r.body);
      });

      it('reemplaza solo las cantidades de ese día y no toca los demás', async () => {
        const c = await alta();
        const cookie = await entrar();
        await guardar(cookie).expect(200); // A: lun 6 / mié 6 · B: vie 4
        const r = await guardarDia(cookie, 'LUNES', L([B(), 3])).expect(200);
        // El lunes ahora es solo B×3; A conserva el miércoles y B conserva el viernes.
        expect(r.body.favorito.lineas).toEqual([
          { productId: A(), nombre: 'Café americano', dias: { MIERCOLES: 6 } },
          { productId: B(), nombre: 'Concha', dias: { VIERNES: 4, LUNES: 3 } },
        ]);
        // Guardar el miércoles no altera el lunes.
        const m = await guardarDia(cookie, 'MIERCOLES', L([A(), 9])).expect(
          200,
        );
        expect(m.body.favorito.lineas).toEqual([
          { productId: A(), nombre: 'Café americano', dias: { MIERCOLES: 9 } },
          { productId: B(), nombre: 'Concha', dias: { VIERNES: 4, LUNES: 3 } },
        ]);
        // Un producto que se queda sin ningún día sale del favorito.
        await guardarDia(cookie, 'VIERNES', L([A(), 1])).expect(200);
        const fila = await s.h.prisma.cliente.findUniqueOrThrow({
          where: { id: c.id },
        });
        expect((fila.favoritoB2b as any).lineas).toEqual([
          {
            productId: A(),
            nombre: 'Café americano',
            dias: { MIERCOLES: 9, VIERNES: 1 },
          },
          { productId: B(), nombre: 'Concha', dias: { LUNES: 3 } },
        ]);
      });

      it('dos días guardados en paralelo (dos teléfonos del mismo cliente) conservan ambos', async () => {
        const c = await alta();
        await s.h.prisma.clienteTelefono.create({
          data: {
            tenantId: s.base.tenant.id,
            clienteId: c.id,
            telefono: '5544445555',
          },
        });
        const uno = await entrar(TEL);
        const dos = await entrar('5544445555');
        const [r1, r2] = await Promise.all([
          guardarDia(uno, 'LUNES', L([A(), 5])),
          guardarDia(dos, 'MARTES', L([B(), 7])),
        ]);
        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        const f = (await leer(uno).expect(200)).body.favorito;
        expect(f.lineas).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ productId: A(), dias: { LUNES: 5 } }),
            expect.objectContaining({ productId: B(), dias: { MARTES: 7 } }),
          ]),
        );
        expect(f.lineas).toHaveLength(2);
      });

      it('las cantidades 0 se descartan; sin ninguna cantidad > 0 → 400; repetido, día o cantidad inválidos → 400', async () => {
        await alta();
        const cookie = await entrar();
        const ok = await guardarDia(
          cookie,
          'JUEVES',
          L([A(), 4], [B(), 0]),
        ).expect(200);
        expect(ok.body.favorito.lineas).toEqual([
          { productId: A(), nombre: 'Café americano', dias: { JUEVES: 4 } },
        ]);
        await guardarDia(cookie, 'JUEVES', L([A(), 0])).expect(400);
        await guardarDia(cookie, 'JUEVES', []).expect(400);
        await guardarDia(cookie, 'JUEVES', L([A(), 1], [A(), 2])).expect(400);
        await guardarDia(cookie, 'FERIADO', L([A(), 1])).expect(400);
        await guardarDia(cookie, 'JUEVES', L([A(), -1])).expect(400);
        await guardarDia(cookie, 'JUEVES', L([A(), 1.5])).expect(400);
        await guardarDia(cookie, 'JUEVES', L([A(), 10000])).expect(400);
        await guardarDia(cookie, 'JUEVES', [
          { productId: 'no-uuid', cantidad: 1 },
        ]).expect(400);
        // Los rechazos no tocaron lo guardado.
        expect(
          (await leer(cookie).expect(200)).body.favorito.lineas,
        ).toHaveLength(1);
      });

      it('producto no disponible o de otro negocio → 409 sin guardar nada', async () => {
        await alta();
        const cookie = await entrar();
        await guardarDia(cookie, 'LUNES', L([A(), 3])).expect(200);
        await s.h.prisma.product.update({
          where: { id: B() },
          data: { disponible: false },
        });
        await guardarDia(cookie, 'MARTES', L([B(), 2])).expect(409);
        await guardarDia(
          cookie,
          'MARTES',
          L(['00000000-0000-4000-8000-000000000000', 2]),
        ).expect(409);
        const f = (await leer(cookie).expect(200)).body.favorito;
        expect(f.lineas).toEqual([
          { productId: A(), nombre: 'Café americano', dias: { LUNES: 3 } },
        ]);
      });

      it('sin sesión → 401; sin encabezado → 400; la cookie de otro negocio no guarda', async () => {
        await alta();
        const cookie = await entrar();
        await http()
          .put('/portal/favorito/dia')
          .set(H)
          .send({ slug: slug(), dia: 'LUNES', lineas: L([A(), 1]) })
          .expect(401);
        await http()
          .put('/portal/favorito/dia')
          .set('Cookie', cookie)
          .send({ slug: slug(), dia: 'LUNES', lineas: L([A(), 1]) })
          .expect(400);
      });

      it('con varios clientes sin elegir → 409; el favorito de otro cliente no se toca', async () => {
        const c1 = await alta(TEL, { negocioNombre: 'Sucursal Centro' });
        const c2 = await alta('5511112222', {
          negocioNombre: 'Sucursal Norte',
        });
        await s.h.prisma.clienteTelefono.create({
          data: {
            tenantId: s.base.tenant.id,
            clienteId: c2.id,
            telefono: TEL,
          },
        });
        const sinElegir = await entrar(TEL);
        await guardarDia(sinElegir, 'LUNES', L([A(), 1])).expect(409);
        const cookie = await entrar(TEL, slug(), c1.id);
        await guardarDia(cookie, 'LUNES', L([A(), 2])).expect(200);
        const otro = await s.h.prisma.cliente.findUniqueOrThrow({
          where: { id: c2.id },
        });
        expect(otro.favoritoB2b).toBeNull();
      });
    });
  });

  describe('catálogo público cerrado', () => {
    it('el catálogo de mayoreo y la vista previa de códigos ya no existen sin sesión', async () => {
      for (const ruta of ['catalog', 'codigos-descuento/PROMO10']) {
        await http()
          .get(`/public/pedidos-b2b/tenants/${slug()}/${ruta}`)
          .expect(404);
      }
      // La información del negocio (nombre y logo para la pantalla de acceso) sigue pública.
      await http().get(`/public/pedidos-b2b/tenants/${slug()}`).expect(200);
    });
  });
});
