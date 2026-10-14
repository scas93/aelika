import request from 'supertest';
import { seedBase } from './db';
import { usarSuite } from './helpers';
import { altaClienteB2bDePrueba } from './b2b-helpers';

// Fase 4 · 4e · Ver mis pedidos: lista y detalle del cliente de la sesión, aislamiento, lista blanca, favorito desde el detalle.
// Reloj de la suite: miércoles 2026-09-30 10:00 CDMX. Semana en curso 2026-09-28, siguiente 2026-10-05.
describe('Portal · ver mis pedidos (4e)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const http = () => request(s.h.app.getHttpServer());
  const H = { 'x-portal-request': '1' };
  const TEL = '3331006915';
  let idem = 0;
  const llave = () => `llave-4e-${String(++idem).padStart(6, '0')}`;

  const entorno = { ...process.env };
  beforeEach(() => {
    process.env.PORTAL_CODIGO_EN_LOG = 'true';
    delete process.env.RAILWAY_PROJECT_NAME;
  });
  // Sin mínimo de piezas: esta suite prueba la lectura, no esa regla.
  beforeEach(async () => {
    await s.h.prisma.tenant.update({
      where: { id: s.base.tenant.id },
      data: { pedidoB2bMinimoPiezas: 0, portalHorizonteSemanas: 4 },
    });
  });
  afterEach(() => {
    process.env = { ...entorno };
  });

  const slug = () => s.base.tenant.slug;
  const cookieDe = (res: request.Response, nombre: string) =>
    ((res.headers['set-cookie'] as unknown as string[]) ?? []).find((c) =>
      c.startsWith(`${nombre}=`),
    );

  async function entrar(telefono = TEL, sl = slug()) {
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
    return `${nombre}=${(cookieDe(v, nombre) as string).split(';')[0].split('=')[1]}`;
  }
  const alta = (telefono = TEL, extra: Record<string, unknown> = {}) =>
    altaClienteB2bDePrueba(s.h, s.base, {
      contactoTelefono: telefono,
      ...extra,
    });

  const A = () => s.base.productoA.id; // Café americano $45
  const B = () => s.base.productoB.id; // Concha $30.50
  const crear = (
    cookie: string,
    entregas: { fecha: string; items: [string, number][] }[],
    extra: Record<string, unknown> = {},
    sl = slug(),
  ) =>
    http()
      .post('/portal/pedidos')
      .set(H)
      .set('Cookie', cookie)
      .set('Idempotency-Key', llave())
      .send({
        slug: sl,
        entregas: entregas.map((e) => ({
          fecha: e.fecha,
          items: e.items.map(([productId, cantidad]) => ({
            productId,
            cantidad,
          })),
        })),
        ...extra,
      })
      .expect(201);

  const lista = (cookie: string, q = '') =>
    http().get(`/portal/pedidos?slug=${slug()}${q}`).set('Cookie', cookie);
  const detalle = (cookie: string, folio: string, sl = slug()) =>
    http().get(`/portal/pedidos/${folio}?slug=${sl}`).set('Cookie', cookie);

  // Un pedido de la semana en curso con dos entregas (viernes 2 y sábado 3): Café x2 + Concha x1 y Café x3.
  const pedidoBase = (cookie: string, extra: Record<string, unknown> = {}) =>
    crear(
      cookie,
      [
        {
          fecha: '2026-10-02',
          items: [
            [A(), 2],
            [B(), 1],
          ],
        },
        { fecha: '2026-10-03', items: [[A(), 3]] },
      ],
      extra,
    );

  describe('autenticación', () => {
    it('sin sesión → 401 en lista, detalle y favorito', async () => {
      await alta();
      await http().get(`/portal/pedidos?slug=${slug()}`).expect(401);
      await http().get(`/portal/pedidos/P-000001?slug=${slug()}`).expect(401);
      await http()
        .post('/portal/pedidos/P-000001/favorito')
        .set(H)
        .send({ slug: slug() })
        .expect(401);
    });

    it('sin cliente activo (teléfono en varios clientes sin elegir) → 409', async () => {
      await alta(TEL, { negocioNombre: 'Sucursal Centro' });
      await alta(TEL, { negocioNombre: 'Sucursal Norte' });
      const cookie = await entrar();
      await lista(cookie).expect(409);
    });
  });

  describe('lista', () => {
    it('sin pedidos → listas vacías', async () => {
      await alta();
      const r = await lista(await entrar()).expect(200);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.body).toEqual({
        activos: [],
        anteriores: [],
        siguienteCursor: null,
      });
    });

    it('activos y anteriores con estado en español, pago y total; sin nombres internos', async () => {
      await alta();
      const cookie = await entrar();
      const r1 = await pedidoBase(cookie);
      const folio = r1.body.pedidos[0].folio as string;

      // Un pedido de la semana siguiente que luego se cancela, y otro completado y pagado.
      const r2 = await crear(cookie, [
        { fecha: '2026-10-12', items: [[B(), 4]] },
      ]);
      await s.h.prisma.order.updateMany({
        where: { folio: r2.body.pedidos[0].folio, tipo: 'B2B' },
        data: { cancelado: true, canceladoAt: new Date() },
      });

      const r = await lista(cookie).expect(200);
      expect(r.body.activos).toEqual([
        {
          folio,
          semanaInicio: '2026-09-28',
          semanaFin: '2026-10-04',
          estado: {
            codigo: 'PENDIENTE_CONFIRMACION',
            etiqueta: 'Por confirmar',
          },
          pago: {
            estado: 'PENDIENTE',
            etiqueta: 'Pago pendiente',
            pagadoAt: null,
          },
          modificadoPorCliente: false,
          totalPiezas: 6,
          total: 255.5,
          fechasEntrega: ['2026-10-02', '2026-10-03'],
        },
      ]);
      expect(r.body.anteriores).toHaveLength(1);
      expect(r.body.anteriores[0].estado).toEqual({
        codigo: 'CANCELADO',
        etiqueta: 'Cancelado',
      });
      // Nada de nombres internos en ninguna parte.
      expect(JSON.stringify(r.body)).not.toMatch(
        /CONFIRMADO_SURTIENDO|EN_PROCESO"|DESPACHADO|tenantId|clienteId/,
      );
    });

    it('estados: Confirmado, En proceso y Completado (con DESPACHADO heredado) en español', async () => {
      await alta();
      const cookie = await entrar();
      const folios: string[] = [];
      for (const fecha of ['2026-10-02', '2026-10-12', '2026-10-19']) {
        const r = await crear(cookie, [{ fecha, items: [[A(), 1]] }]);
        folios.push(r.body.pedidos[0].folio);
      }
      const pon = (folio: string, estadoPedido: string) =>
        s.h.prisma.order.updateMany({
          where: { folio, tipo: 'B2B' },
          data: { estadoPedido: estadoPedido as never },
        });
      await pon(folios[0], 'CONFIRMADO_SURTIENDO');
      await pon(folios[1], 'EN_PROCESO');
      await pon(folios[2], 'DESPACHADO');
      await s.h.prisma.order.updateMany({
        where: { folio: folios[2], tipo: 'B2B' },
        data: { estadoPago: 'PAGADO' },
      });
      await s.h.prisma.detalleB2B.updateMany({
        where: { order: { folio: folios[2], tipo: 'B2B' } },
        data: { pagadoAt: new Date('2026-10-01T15:00:00Z') },
      });

      const r = await lista(cookie).expect(200);
      const etiquetas = (
        xs: { folio: string; estado: { etiqueta: string } }[],
      ) => Object.fromEntries(xs.map((x) => [x.folio, x.estado.etiqueta]));
      expect(etiquetas(r.body.activos)).toEqual({
        [folios[0]]: 'Confirmado',
        [folios[1]]: 'En proceso',
      });
      expect(etiquetas(r.body.anteriores)).toEqual({
        [folios[2]]: 'Completado',
      });
      expect(r.body.anteriores[0].pago).toEqual({
        estado: 'PAGADO',
        etiqueta: 'Pagado',
        pagadoAt: '2026-10-01T15:00:00.000Z',
      });
    });

    it('anteriores se paginan (20 por página) con cursor y vienen de la semana más reciente a la más antigua', async () => {
      const c = await alta();
      const cookie = await entrar();
      const base = new Date('2026-01-05T00:00:00Z'); // lunes
      for (let i = 0; i < 25; i++) {
        const semana = new Date(base.getTime() + i * 7 * 86400000);
        const o = await s.h.prisma.order.create({
          data: {
            tenantId: s.base.tenant.id,
            folio: `H-${String(i + 1).padStart(6, '0')}`,
            clienteNombre: 'Cafetería La Esquina',
            clienteTelefono: TEL,
            clienteId: c.id,
            tipo: 'B2B',
            estadoPedido: 'COMPLETADO',
            total: '10.00',
            metodoPago: null,
            estadoPago: 'PENDIENTE',
          },
        });
        await s.h.prisma.detalleB2B.create({
          data: {
            tenantId: s.base.tenant.id,
            orderId: o.id,
            negocioNombre: 'Cafetería La Esquina',
            semanaInicio: semana,
            modoCobro: 'AL_FINAL' as never,
            minimoPiezasAplicado: 0,
            totalPiezas: 1,
            subtotal: '10.00',
          },
        });
      }
      const p1 = await lista(cookie).expect(200);
      expect(p1.body.anteriores).toHaveLength(20);
      expect(p1.body.siguienteCursor).toBe('20');
      expect(p1.body.anteriores[0].folio).toBe('H-000025');
      const p2 = await lista(cookie, '&cursor=20').expect(200);
      expect(p2.body.anteriores).toHaveLength(5);
      expect(p2.body.anteriores[4].folio).toBe('H-000001');
      expect(p2.body.siguienteCursor).toBeNull();
      expect(p2.body.activos).toEqual([]);
      await lista(cookie, '&cursor=abc').expect(404);
    });
  });

  describe('detalle', () => {
    it('entregas por fecha con estado, productos, cantidades, precio unitario, subtotal, descuento, nota y total', async () => {
      await alta(TEL, { descuentoPorcentaje: 10 });
      const cookie = await entrar();
      const c = await pedidoBase(cookie, { notaCliente: 'Tocar el timbre' });
      const folio = c.body.pedidos[0].folio as string;

      const r = await detalle(cookie, folio).expect(200);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.body).toEqual({
        folio,
        semanaInicio: '2026-09-28',
        semanaFin: '2026-10-04',
        estado: { codigo: 'PENDIENTE_CONFIRMACION', etiqueta: 'Por confirmar' },
        pago: {
          estado: 'PENDIENTE',
          etiqueta: 'Pago pendiente',
          pagadoAt: null,
        },
        modificadoPorCliente: false,
        totalPiezas: 6,
        total: 229.95,
        subtotal: 255.5,
        descuentoPorcentaje: 10,
        descuentoTotal: 25.55,
        notaCliente: 'Tocar el timbre',
        esFavorito: false,
        modificable: true,
        version: expect.any(String),
        entregas: [
          {
            fecha: '2026-10-02',
            estado: { codigo: 'PENDIENTE', etiqueta: 'Pendiente' },
            productos: [
              {
                nombre: 'Café americano',
                cantidad: 2,
                precioUnitario: 45,
                subtotal: 90,
              },
              {
                nombre: 'Concha',
                cantidad: 1,
                precioUnitario: 30.5,
                subtotal: 30.5,
              },
            ],
          },
          {
            fecha: '2026-10-03',
            estado: { codigo: 'PENDIENTE', etiqueta: 'Pendiente' },
            productos: [
              {
                nombre: 'Café americano',
                cantidad: 3,
                precioUnitario: 45,
                subtotal: 135,
              },
            ],
          },
        ],
      });
    });

    it('entregas canceladas se muestran con la etiqueta «Cancelada»; los estados de entrega salen en español', async () => {
      await alta();
      const cookie = await entrar();
      const folio = (await pedidoBase(cookie)).body.pedidos[0].folio as string;
      const orden = await s.h.prisma.order.findFirstOrThrow({
        where: { folio, tipo: 'B2B' },
      });
      await s.h.prisma.entrega.updateMany({
        where: { orderId: orden.id, fecha: new Date('2026-10-02') },
        data: { estado: 'ENTREGADA' },
      });
      await s.h.prisma.entrega.updateMany({
        where: { orderId: orden.id, fecha: new Date('2026-10-03') },
        data: { estado: 'CANCELADA' },
      });
      const r = await detalle(cookie, folio).expect(200);
      expect(
        r.body.entregas.map((e: any) => [e.fecha, e.estado.etiqueta]),
      ).toEqual([
        ['2026-10-02', 'Entregada'],
        ['2026-10-03', 'Cancelada'],
      ]);
    });

    it('pedido pagado muestra «Pagado» con su fecha; el snapshot de nombre y precio sobrevive a un producto borrado', async () => {
      await alta();
      const cookie = await entrar();
      const folio = (await pedidoBase(cookie)).body.pedidos[0].folio as string;
      await s.h.prisma.order.updateMany({
        where: { folio, tipo: 'B2B' },
        data: { estadoPago: 'PAGADO' },
      });
      await s.h.prisma.detalleB2B.updateMany({
        where: { order: { folio, tipo: 'B2B' } },
        data: { pagadoAt: new Date('2026-10-01T16:30:00Z') },
      });
      await s.h.prisma.product.update({
        where: { id: B() },
        data: { precio: '99.00', nombre: 'Concha renombrada' },
      });
      const r = await detalle(cookie, folio).expect(200);
      expect(r.body.pago).toEqual({
        estado: 'PAGADO',
        etiqueta: 'Pagado',
        pagadoAt: '2026-10-01T16:30:00.000Z',
      });
      expect(r.body.entregas[0].productos[1]).toMatchObject({
        nombre: 'Concha',
        precioUnitario: 30.5,
      });
    });

    it('lista blanca: solo los campos documentados, a cualquier profundidad', async () => {
      await alta();
      const cookie = await entrar();
      const folio = (await pedidoBase(cookie, { notaCliente: 'N' })).body
        .pedidos[0].folio as string;
      // Datos internos que NO deben salir: nota interna de la entrega, hora/destino, quién cambió el estado.
      const orden = await s.h.prisma.order.findFirstOrThrow({
        where: { folio, tipo: 'B2B' },
      });
      await s.h.prisma.entrega.updateMany({
        where: { orderId: orden.id },
        data: {
          nota: 'NOTA-INTERNA-SECRETA',
          hora: '07:30',
          destino: 'DESTINO-X',
        },
      });
      const r = await detalle(cookie, folio).expect(200);
      const claves = new Set<string>();
      const recorrer = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(recorrer);
        else if (v && typeof v === 'object')
          for (const [k, x] of Object.entries(v)) {
            claves.add(k);
            recorrer(x);
          }
      };
      recorrer(r.body);
      expect([...claves].sort()).toEqual(
        [
          'cantidad',
          'codigo',
          'descuentoPorcentaje',
          'descuentoTotal',
          'entregas',
          'esFavorito',
          'estado',
          'etiqueta',
          'fecha',
          'folio',
          'modificable',
          'modificadoPorCliente',
          'nombre',
          'notaCliente',
          'pagadoAt',
          'pago',
          'precioUnitario',
          'productos',
          'semanaFin',
          'semanaInicio',
          'subtotal',
          'total',
          'totalPiezas',
          'version',
        ].sort(),
      );
      expect(JSON.stringify(r.body)).not.toMatch(
        /NOTA-INTERNA|DESTINO-X|07:30|tenantId|clienteId|erpId|facturaRfc|estadoCambiado/,
      );
    });
  });

  describe('aislamiento', () => {
    it('un cliente no ve pedidos de otro cliente del mismo negocio: lista vacía y detalle 404 (no 403)', async () => {
      await alta(TEL, { negocioNombre: 'Sucursal Centro' });
      await alta('5511112222', { negocioNombre: 'Sucursal Norte' });
      const folio = (await pedidoBase(await entrar(TEL))).body.pedidos[0]
        .folio as string;

      const otro = await entrar('5511112222');
      const l = await lista(otro).expect(200);
      expect(l.body.activos).toEqual([]);
      expect(l.body.anteriores).toEqual([]);
      const d = await detalle(otro, folio).expect(404);
      const inexistente = await detalle(otro, 'P-999999').expect(404);
      // Misma respuesta que un folio que no existe: no se confirma que el pedido es de alguien más.
      expect(d.body.message).toBe(inexistente.body.message);
      await http()
        .post(`/portal/pedidos/${folio}/favorito`)
        .set(H)
        .set('Cookie', otro)
        .send({ slug: slug() })
        .expect(404);
    });

    it('un cliente no ve pedidos de otro negocio aunque el folio coincida, ni con la cookie de otro negocio', async () => {
      await alta();
      const otro = await seedBase(s.h.prisma, {
        slug: 'otro-mayoreo',
        tipoStorefront: 'RETAIL_B2B',
      });
      await s.h.prisma.tenant.update({
        where: { id: otro.tenant.id },
        data: { pedidoB2bMinimoPiezas: 0 },
      });
      await altaClienteB2bDePrueba(s.h, otro, { contactoTelefono: TEL });
      const cookieOtro = await entrar(TEL, 'otro-mayoreo');
      const r = await http()
        .post('/portal/pedidos')
        .set(H)
        .set('Cookie', cookieOtro)
        .set('Idempotency-Key', llave())
        .send({
          slug: 'otro-mayoreo',
          entregas: [
            {
              fecha: '2026-10-02',
              items: [{ productId: otro.productoA.id, cantidad: 1 }],
            },
          ],
        })
        .expect(201);
      const folio = r.body.pedidos[0].folio as string;

      const cookie = await entrar();
      // Mismo folio en el negocio propio (sin ese pedido) → 404.
      await detalle(cookie, folio).expect(404);
      // La cookie de un negocio no vale para el otro: 401.
      await detalle(cookieOtro, folio, slug()).expect(401);
      expect((await lista(cookie).expect(200)).body.activos).toEqual([]);
    });

    it('folios mal formados → 404', async () => {
      await alta();
      const cookie = await entrar();
      for (const f of ['..%2Fetc', 'P-0000%2001', 'x'.repeat(60)])
        await detalle(cookie, f).expect(404);
    });
  });

  describe('favorito desde el detalle', () => {
    const usar = (cookie: string, folio: string) =>
      http()
        .post(`/portal/pedidos/${folio}/favorito`)
        .set(H)
        .set('Cookie', cookie)
        .send({ slug: slug() });

    it('guarda productos y cantidades por día, sin precios ni folio; reemplaza al anterior (uno por cliente)', async () => {
      const c = await alta();
      const cookie = await entrar();
      const folio = (await pedidoBase(cookie)).body.pedidos[0].folio as string;
      const r = await usar(cookie, folio).expect(200);
      expect(r.body.omitidos).toEqual([]);
      expect(r.body.favorito.lineas).toEqual([
        {
          productId: A(),
          nombre: 'Café americano',
          dias: { VIERNES: 2, SABADO: 3 },
        },
        { productId: B(), nombre: 'Concha', dias: { VIERNES: 1 } },
      ]);
      const fila = await s.h.prisma.cliente.findUniqueOrThrow({
        where: { id: c.id },
      });
      const guardado = JSON.stringify(fila.favoritoB2b);
      expect(guardado).not.toContain(folio);
      expect(guardado).not.toMatch(/precio/i);

      // El detalle ya lo marca como favorito.
      expect((await detalle(cookie, folio).expect(200)).body.esFavorito).toBe(
        true,
      );

      // Otro pedido lo reemplaza: sigue habiendo uno solo.
      const f2 = (
        await crear(cookie, [{ fecha: '2026-10-12', items: [[B(), 5]] }])
      ).body.pedidos[0].folio as string;
      await usar(cookie, f2).expect(200);
      const l = await http()
        .get(`/portal/favorito?slug=${slug()}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(l.body.favorito.lineas).toEqual([
        { productId: B(), nombre: 'Concha', dias: { LUNES: 5 } },
      ]);
      expect((await detalle(cookie, folio).expect(200)).body.esFavorito).toBe(
        false,
      );
      expect((await detalle(cookie, f2).expect(200)).body.esFavorito).toBe(
        true,
      );
    });

    it('omite entregas canceladas y productos no disponibles y los nombra; sin ninguno disponible → 409', async () => {
      await alta();
      const cookie = await entrar();
      const folio = (await pedidoBase(cookie)).body.pedidos[0].folio as string;
      const orden = await s.h.prisma.order.findFirstOrThrow({
        where: { folio, tipo: 'B2B' },
      });
      await s.h.prisma.entrega.updateMany({
        where: { orderId: orden.id, fecha: new Date('2026-10-03') },
        data: { estado: 'CANCELADA' },
      });
      await s.h.prisma.product.update({
        where: { id: B() },
        data: { disponible: false },
      });
      const r = await usar(cookie, folio).expect(200);
      expect(r.body.omitidos).toEqual(['Concha']);
      expect(r.body.favorito.lineas).toEqual([
        { productId: A(), nombre: 'Café americano', dias: { VIERNES: 2 } },
      ]);

      await s.h.prisma.product.update({
        where: { id: A() },
        data: { disponible: false },
      });
      await usar(cookie, folio).expect(409);
    });

    it('sin encabezado anti-CSRF → 400', async () => {
      await alta();
      const cookie = await entrar();
      const folio = (await pedidoBase(cookie)).body.pedidos[0].folio as string;
      await http()
        .post(`/portal/pedidos/${folio}/favorito`)
        .set('Cookie', cookie)
        .send({ slug: slug() })
        .expect(400);
    });
  });
});
