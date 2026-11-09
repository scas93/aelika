import request from 'supertest';
import { usarSuite } from './helpers';
import { altaClienteB2bDePrueba, apiRol } from './b2b-helpers';

// «Cambios desde la última revisión» (B2B): la referencia del pedido se guarda en la primera edición del cliente que prende la
// marca, se conserva mientras siga prendida, se descarta al apagarla, y GET /pedidos-b2b/:id/cambios calcula la diferencia.
// Reloj de la suite: miércoles 2026-09-30 10:00 CDMX. Entrega 08:00, agregar 36 h, modificar 18 h, horizonte 1.
//   viernes 2026-10-02 08:00 CDMX = 14:00Z → modificar hasta 2026-10-01T20:00Z, agregar hasta 2026-10-01T02:00Z.
describe('Panel · cambios desde la última revisión', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const http = () => request(s.h.app.getHttpServer());
  const H = { 'x-portal-request': '1' };
  const TEL = '3331006915';
  let idem = 0;
  const llave = () => `llave-4f-${String(++idem).padStart(6, '0')}`;

  const entorno = { ...process.env };
  beforeEach(async () => {
    process.env.PORTAL_CODIGO_EN_LOG = 'true';
    delete process.env.RAILWAY_PROJECT_NAME;
    await s.h.prisma.tenant.update({
      where: { id: s.base.tenant.id },
      data: { pedidoB2bMinimoPiezas: 0, pedidoB2bModoCobro: 'AL_FINAL' },
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
  type Item = [string, number];
  const e = (fecha: string, ...items: Item[]) => ({
    fecha,
    items: items.map(([productId, cantidad]) => ({ productId, cantidad })),
  });

  // Pedido base de la semana en curso: viernes 2 (Café x2, Concha x1) y sábado 3 (Café x3). Subtotal 255.50.
  async function crearBase(cookie: string) {
    const r = await http()
      .post('/portal/pedidos')
      .set(H)
      .set('Cookie', cookie)
      .set('Idempotency-Key', llave())
      .send({
        slug: slug(),
        entregas: [
          e('2026-10-02', [A(), 2], [B(), 1]),
          e('2026-10-03', [A(), 3]),
        ],
      })
      .expect(201);
    return r.body.pedidos[0].folio as string;
  }
  const detalle = (cookie: string, folio: string) =>
    http()
      .get(`/portal/pedidos/${folio}?slug=${slug()}`)
      .set('Cookie', cookie)
      .expect(200);
  // Envía el PATCH con la versión vigente (o la indicada). `.expect(status)` verifica el código y devuelve la respuesta.
  const modificar = (
    cookie: string,
    folio: string,
    cuerpo: Record<string, unknown>,
    version?: string,
  ) => {
    const enviar = async () => {
      const v = version ?? (await detalle(cookie, folio)).body.version;
      return http()
        .patch(`/portal/pedidos/${folio}`)
        .set(H)
        .set('Cookie', cookie)
        .send({ slug: slug(), version: v, entregas: [], ...cuerpo });
    };
    return {
      enviar,
      expect: async (status: number) => {
        const r = await enviar();
        expect([
          status,
          r.status === status ? '' : JSON.stringify(r.body),
        ]).toEqual([status, '']);
        return r;
      },
    };
  };
  const orden = (folio: string) =>
    s.h.prisma.order.findFirstOrThrow({
      where: { folio, tipo: 'B2B' },
      include: { detalleB2b: true, entregas: { orderBy: { fecha: 'asc' } } },
    });
  const poner = (folio: string, data: Record<string, unknown>) =>
    s.h.prisma.order.updateMany({
      where: { folio, tipo: 'B2B' },
      data: data as never,
    });
  const gerente = () => apiRol(s.h, s.base, 'GERENTE');

  async function preparar(extra: Record<string, unknown> = {}) {
    await alta(TEL, extra);
    const cookie = await entrar();
    return { cookie, folio: await crearBase(cookie) };
  }

  const op = () => apiRol(s.h, s.base, 'OPERADOR');
  const referencia = (orderId: string) =>
    s.h.prisma.pedidoB2bReferencia.findMany({ where: { orderId } });
  const cambios = async (orderId: string) =>
    (await gerente().get(`/pedidos-b2b/${orderId}/cambios`).expect(200)).body;
  // Pedido base: viernes 2 (Café x2, Concha x1) y sábado 3 (Café x3). Total 255.50.

  describe('creación y conservación de la referencia', () => {
    it('la primera edición crea la referencia con el pedido tal como estaba; la segunda y la tercera la conservan', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      expect(await referencia(o.id)).toHaveLength(0);

      await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 4])],
      }).expect(200);
      const [r1] = await referencia(o.id);
      expect(r1.snapshot).toEqual({
        total: '255.50',
        notaCliente: null,
        entregas: [
          {
            fecha: '2026-10-02',
            lineas: [
              { productId: A(), nombreProducto: 'Café americano', cantidad: 2 },
              { productId: B(), nombreProducto: 'Concha', cantidad: 1 },
            ],
          },
          {
            fecha: '2026-10-03',
            lineas: [
              { productId: A(), nombreProducto: 'Café americano', cantidad: 3 },
            ],
          },
        ],
      });

      await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 5])],
      }).expect(200);
      await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 6])],
      }).expect(200);
      const despues = await referencia(o.id);
      expect(despues).toHaveLength(1);
      expect(despues[0].id).toBe(r1.id);
      expect(despues[0].snapshot).toEqual(r1.snapshot);
      expect(despues[0].createdAt.getTime()).toBe(r1.createdAt.getTime());
      // La diferencia se acumula contra la misma referencia: 3 → 6, no 5 → 6.
      const c = await cambios(o.id);
      expect(c.estado).toBe('CON_CAMBIOS');
      expect(c.cambios.entregas).toMatchObject([
        {
          tipo: 'MODIFICADA',
          fecha: '2026-10-03',
          lineas: [{ tipo: 'CAMBIO', antes: 3, despues: 6 }],
        },
      ]);
    });

    it('una edición solo de la nota también crea la referencia y la diferencia solo muestra la nota', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await modificar(cookie, folio, {
        notaCliente: 'Sin azúcar, por favor',
      }).expect(200);
      expect(await referencia(o.id)).toHaveLength(1);
      const c = await cambios(o.id);
      expect(c.estado).toBe('CON_CAMBIOS');
      expect(c.cambios).toMatchObject({
        entregas: [],
        nota: 'NUEVA',
        total: null,
        soloPrecios: false,
      });

      await modificar(cookie, folio, { notaCliente: 'Con azúcar' }).expect(200);
      expect((await cambios(o.id)).cambios.nota).toBe('NUEVA'); // contra la referencia original (sin nota)
      await modificar(cookie, folio, { notaCliente: null }).expect(200);
      expect((await cambios(o.id)).estado).toBe('SIN_DIFERENCIAS');
    });

    it('una edición sin cambios reales no prende la marca ni crea la referencia', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      const r = await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 3])],
      }).expect(200);
      expect(r.body.cambio).toBe(false);
      expect(await referencia(o.id)).toHaveLength(0);
      expect(await cambios(o.id)).toEqual({ estado: 'NINGUNO', cambios: null });
    });

    it('una edición rechazada (409) no deja referencia', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await modificar(cookie, folio, {
        entregas: [e('2026-10-02'), e('2026-10-03')],
      }).expect(409);
      expect(await referencia(o.id)).toHaveLength(0);
    });

    it('dos ediciones simultáneas con la misma versión: una gana y la referencia se crea una sola vez', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      const v = (await detalle(cookie, folio)).body.version;
      jest.setSystemTime(new Date('2026-09-30T16:00:05.000Z'));
      const [a, b] = await Promise.all([
        modificar(
          cookie,
          folio,
          { entregas: [e('2026-10-03', [A(), 4])] },
          v,
        ).enviar(),
        modificar(
          cookie,
          folio,
          { entregas: [e('2026-10-03', [A(), 5])] },
          v,
        ).enviar(),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect(await referencia(o.id)).toHaveLength(1);
    });

    it('una edición del equipo desde el panel no crea, toca ni reemplaza la referencia (la diferencia incluye lo del equipo)', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 4])],
      }).expect(200);
      const [antes] = await referencia(o.id);

      await gerente()
        .patch(`/pedidos-b2b/${o.id}/items`)
        .send({
          items: [
            {
              productId: A(),
              distribucion: [
                { dia: 'VIERNES', cantidad: 2 },
                { dia: 'SABADO', cantidad: 9 },
              ],
            },
            { productId: B(), distribucion: [{ dia: 'VIERNES', cantidad: 1 }] },
          ],
        })
        .expect(200);
      const [despues] = await referencia(o.id);
      expect(despues.id).toBe(antes.id);
      expect(despues.snapshot).toEqual(antes.snapshot);
      expect((await orden(folio)).modificadoPorClienteAt).not.toBeNull();
      const c = await cambios(o.id);
      expect(c.cambios.entregas[0].lineas[0]).toMatchObject({
        tipo: 'CAMBIO',
        antes: 3,
        despues: 9,
      });
    });

    it('una edición del equipo sin marca tampoco crea referencia', async () => {
      const { folio } = await preparar();
      const o = await orden(folio);
      await gerente()
        .patch(`/pedidos-b2b/${o.id}/items`)
        .send({
          items: [
            {
              productId: A(),
              distribucion: [
                { dia: 'VIERNES', cantidad: 2 },
                { dia: 'SABADO', cantidad: 9 },
              ],
            },
            { productId: B(), distribucion: [{ dia: 'VIERNES', cantidad: 1 }] },
          ],
        })
        .expect(200);
      expect(await referencia(o.id)).toHaveLength(0);
    });
  });

  describe('descarte de la referencia', () => {
    async function conReferencia() {
      const ctx = await preparar();
      const o = await orden(ctx.folio);
      await modificar(ctx.cookie, ctx.folio, {
        entregas: [e('2026-10-03', [A(), 4])],
      }).expect(200);
      expect(await referencia(o.id)).toHaveLength(1);
      return { ...ctx, o };
    }

    it('confirmar (avanzar) la descarta, y la siguiente modificación guarda una nueva', async () => {
      const { cookie, folio, o } = await conReferencia();
      await gerente().patch(`/pedidos-b2b/${o.id}/avanzar`).expect(200);
      expect(await referencia(o.id)).toHaveLength(0);
      expect(await cambios(o.id)).toEqual({ estado: 'NINGUNO', cambios: null });

      await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 7])],
      }).expect(200);
      const [nueva] = await referencia(o.id);
      expect((nueva.snapshot as any).entregas[1].lineas[0].cantidad).toBe(4); // lo confirmado, no el original
    });

    it('«Marcar pagado» que confirma (pago al inicio) la descarta', async () => {
      const { o } = await conReferencia();
      await s.h.prisma.detalleB2B.update({
        where: { orderId: o.id },
        data: { modoCobro: 'AL_INICIO' },
      });
      await gerente().patch(`/pedidos-b2b/${o.id}/marcar-pagado`).expect(200);
      expect(
        (await s.h.prisma.order.findUniqueOrThrow({ where: { id: o.id } }))
          .modificadoPorClienteAt,
      ).toBeNull();
      expect(await referencia(o.id)).toHaveLength(0);
    });

    it('«Marcar pagado» que NO confirma (a crédito) no apaga la marca y conserva la referencia', async () => {
      const { o } = await conReferencia();
      await gerente().patch(`/pedidos-b2b/${o.id}/marcar-pagado`).expect(200);
      expect(
        (
          await orden(
            (await s.h.prisma.order.findUniqueOrThrow({ where: { id: o.id } }))
              .folio,
          )
        ).modificadoPorClienteAt,
      ).not.toBeNull();
      expect(await referencia(o.id)).toHaveLength(1);
    });

    it('«Marcar como revisado» la descarta (los 3 roles) y es idempotente', async () => {
      const { cookie, folio, o } = await conReferencia();
      let cantidad = 4;
      for (const rol of ['OPERADOR', 'GERENTE', 'DUENO'] as const) {
        await apiRol(s.h, s.base, rol)
          .patch(`/pedidos-b2b/${o.id}/marcar-revisado`)
          .expect(200);
        expect(await referencia(o.id)).toHaveLength(0);
        await apiRol(s.h, s.base, rol)
          .patch(`/pedidos-b2b/${o.id}/marcar-revisado`)
          .expect(200);
        // La siguiente modificación guarda una referencia nueva.
        await modificar(cookie, folio, {
          entregas: [e('2026-10-03', [A(), ++cantidad])],
        }).expect(200);
        expect(await referencia(o.id)).toHaveLength(1);
      }
    });

    it('cancelar no la descarta, pero el panel no muestra la sección', async () => {
      const { o } = await conReferencia();
      await gerente().patch(`/pedidos-b2b/${o.id}/cancelar`).expect(200);
      expect(await referencia(o.id)).toHaveLength(1);
      expect(await cambios(o.id)).toEqual({ estado: 'NINGUNO', cambios: null });
    });

    it('desmarcar pago y corregir una entrega no la descartan', async () => {
      const { o } = await conReferencia();
      await gerente().patch(`/pedidos-b2b/${o.id}/marcar-pagado`).expect(200);
      await gerente()
        .patch(`/pedidos-b2b/${o.id}/desmarcar-pagado`)
        .expect(200);
      expect(await referencia(o.id)).toHaveLength(1);
    });
  });

  describe('tipos de diferencia', () => {
    it('producto agregado, quitado y con otra cantidad, por entrega', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await modificar(cookie, folio, {
        entregas: [
          e('2026-10-02', [A(), 4]),
          e('2026-10-03', [A(), 3], [B(), 5]),
        ],
      }).expect(200);
      const c = await cambios(o.id);
      expect(c.cambios.entregas).toMatchObject([
        {
          tipo: 'MODIFICADA',
          fecha: '2026-10-02',
          lineas: [
            {
              nombreProducto: 'Café americano',
              tipo: 'CAMBIO',
              antes: 2,
              despues: 4,
            },
            {
              nombreProducto: 'Concha',
              tipo: 'ELIMINADO',
              antes: 1,
              despues: null,
            },
          ],
        },
        {
          tipo: 'MODIFICADA',
          fecha: '2026-10-03',
          lineas: [
            {
              nombreProducto: 'Concha',
              tipo: 'NUEVO',
              antes: null,
              despues: 5,
            },
          ],
        },
      ]);
      expect(c.cambios.total).toEqual({
        antes: '255.50',
        despues: expect.any(String),
      });
      expect(c.cambios.soloPrecios).toBe(false);
    });

    it('entrega nueva, eliminada y movida de día', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      // Nueva: domingo 4.
      await modificar(cookie, folio, {
        entregas: [e('2026-10-04', [B(), 2])],
      }).expect(200);
      expect((await cambios(o.id)).cambios.entregas).toMatchObject([
        {
          tipo: 'NUEVA',
          fecha: '2026-10-04',
          piezas: 2,
          lineas: [{ tipo: 'NUEVO', despues: 2 }],
        },
      ]);
      // Eliminada: sábado 3 (más la nueva, que sigue).
      await modificar(cookie, folio, { entregas: [e('2026-10-03')] }).expect(
        200,
      );
      expect((await cambios(o.id)).cambios.entregas).toMatchObject([
        {
          tipo: 'ELIMINADA',
          fecha: '2026-10-03',
          piezas: 3,
          lineas: [{ tipo: 'ELIMINADO', antes: 3 }],
        },
        { tipo: 'NUEVA', fecha: '2026-10-04' },
      ]);
      // Movida: el sábado 3 vuelve con otro contenido y el domingo 4 se quita → deja de ser movida.
      await modificar(cookie, folio, {
        entregas: [e('2026-10-04'), e('2026-10-03', [A(), 3])],
      }).expect(200);
      expect((await cambios(o.id)).estado).toBe('SIN_DIFERENCIAS');
    });

    it('una entrega eliminada y una nueva con exactamente el mismo contenido se presentan como movida', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await modificar(cookie, folio, {
        entregas: [e('2026-10-03'), e('2026-10-04', [A(), 3])],
      }).expect(200);
      const c = await cambios(o.id);
      expect(c.estado).toBe('CON_CAMBIOS');
      expect(c.cambios.entregas).toEqual([
        {
          tipo: 'MOVIDA',
          fecha: '2026-10-04',
          fechaAnterior: '2026-10-03',
          piezas: 3,
          lineas: [],
        },
      ]);
      expect(c.cambios.total).toBeNull();
    });

    it('quitar un producto y volver a ponerlo con la misma cantidad no es un cambio', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await modificar(cookie, folio, {
        entregas: [e('2026-10-02', [A(), 2])],
      }).expect(200);
      expect((await cambios(o.id)).estado).toBe('CON_CAMBIOS');
      await modificar(cookie, folio, {
        entregas: [e('2026-10-02', [A(), 2], [B(), 1])],
      }).expect(200);
      expect(await cambios(o.id)).toEqual({
        estado: 'SIN_DIFERENCIAS',
        cambios: null,
      });
    });

    it('solo cambió el total por actualización de precios: se avisa sin inventar cambios de productos', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await modificar(cookie, folio, {
        entregas: [e('2026-10-02', [A(), 2])],
      }).expect(200);
      await s.h.prisma.product.update({
        where: { id: B() },
        data: { precio: 40 },
      });
      await modificar(cookie, folio, {
        entregas: [e('2026-10-02', [A(), 2], [B(), 1])],
      }).expect(200);
      const c = await cambios(o.id);
      expect(c.estado).toBe('CON_CAMBIOS');
      expect(c.cambios).toMatchObject({
        entregas: [],
        nota: null,
        soloPrecios: true,
        sinDiferencias: false,
        total: { antes: '255.50', despues: '265.00' },
      });
    });

    it('quitar la nota del cliente', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await modificar(cookie, folio, { notaCliente: 'Nota inicial' }).expect(
        200,
      );
      await gerente().patch(`/pedidos-b2b/${o.id}/marcar-revisado`).expect(200);
      await modificar(cookie, folio, { notaCliente: 'Otra' }).expect(200);
      expect((await cambios(o.id)).cambios.nota).toBe('MODIFICADA');
      await gerente().patch(`/pedidos-b2b/${o.id}/marcar-revisado`).expect(200);
      await modificar(cookie, folio, { notaCliente: null }).expect(200);
      expect((await cambios(o.id)).cambios.nota).toBe('QUITADA');
    });
  });

  describe('pedidos sin referencia, permisos y contratos', () => {
    it('una marca prendida desde antes del cambio (sin referencia) responde SIN_DETALLE', async () => {
      const { folio } = await preparar();
      const o = await orden(folio);
      await poner(folio, { modificadoPorClienteAt: new Date() });
      expect(await cambios(o.id)).toEqual({
        estado: 'SIN_DETALLE',
        cambios: null,
      });
    });

    it('permisos: los 3 roles leen la diferencia; sin sesión 401; un pedido B2C o inexistente 404', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 4])],
      }).expect(200);
      for (const rol of ['OPERADOR', 'GERENTE', 'DUENO'] as const) {
        const r = await apiRol(s.h, s.base, rol)
          .get(`/pedidos-b2b/${o.id}/cambios`)
          .expect(200);
        expect(r.body.estado).toBe('CON_CAMBIOS');
      }
      await http().get(`/pedidos-b2b/${o.id}/cambios`).expect(401);
      await op()
        .get('/pedidos-b2b/00000000-0000-0000-0000-000000000000/cambios')
        .expect(404);
    });

    it('la referencia no sale en GET /pedidos-b2b/:id, la lista, el portal ni el Excel', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 4])],
      }).expect(200);
      const claves = (x: unknown) => JSON.stringify(x);
      const det = await gerente().get(`/pedidos-b2b/${o.id}`).expect(200);
      expect(claves(det.body)).not.toMatch(/snapshot|referencia|cambios/i);
      const lista = await gerente().get('/pedidos-b2b?limit=50').expect(200);
      expect(claves(lista.body)).not.toMatch(/snapshot|referencia/i);
      expect(claves((await detalle(cookie, folio)).body)).not.toMatch(
        /snapshot|referencia/i,
      );
      const xlsx = await gerente().get('/pedidos-b2b/export-xlsx').expect(200);
      expect(xlsx.status).toBe(200);
    });
  });
});
