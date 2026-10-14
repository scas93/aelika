import request from 'supertest';
import { seedBase } from './db';
import { usarSuite } from './helpers';
import { altaClienteB2bDePrueba, apiRol } from './b2b-helpers';

// Fase 4 · 4f · modificar un pedido desde el portal (PATCH /portal/pedidos/:folio), marca «Modificado por el cliente»,
// «Marcar como revisado» y control de versión del panel.
// Reloj de la suite: miércoles 2026-09-30 10:00 CDMX. Entrega 08:00, agregar 36 h, modificar 18 h, horizonte 1.
//   viernes 2026-10-02 08:00 CDMX = 14:00Z → modificar hasta 2026-10-01T20:00Z, agregar hasta 2026-10-01T02:00Z.
describe('Portal · modificar pedido (4f)', () => {
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

  // ------------------------------------------------------------------ estados y marca
  describe('estado y marca', () => {
    it('Confirmado → Por confirmar con la marca; totales con el % del pedido; el pago no cambia', async () => {
      const { cookie, folio } = await preparar({ descuentoPorcentaje: 10 });
      await poner(folio, { estadoPedido: 'CONFIRMADO_SURTIENDO' });
      const antes = await orden(folio);
      expect(Number(antes.total)).toBe(229.95);

      // Sábado: Café x3 → x1 (−$90); subtotal 165.50, descuento 10 %.
      const r = await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 1])],
      }).expect(200);
      expect(r.body.cambio).toBe(true);
      expect(r.body.pedido).toMatchObject({
        estado: { codigo: 'PENDIENTE_CONFIRMACION', etiqueta: 'Por confirmar' },
        modificadoPorCliente: true,
        subtotal: 165.5,
        descuentoPorcentaje: 10,
        descuentoTotal: 16.55,
        total: 148.95,
        totalPiezas: 4,
        pago: { estado: 'PENDIENTE' },
      });
      const despues = await orden(folio);
      expect(despues.estadoPago).toBe(antes.estadoPago);
      expect(despues.modificadoPorClienteAt).not.toBeNull();
    });

    it('Por confirmar conserva su estado y también lleva la marca', async () => {
      const { cookie, folio } = await preparar();
      const r = await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 4])],
      }).expect(200);
      expect(r.body.pedido.estado.codigo).toBe('PENDIENTE_CONFIRMACION');
      expect(r.body.pedido.modificadoPorCliente).toBe(true);
    });

    it('En proceso conserva su estado y muestra la marca; la entrega cerrada no se toca', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await poner(folio, { estadoPedido: 'EN_PROCESO' });
      await s.h.prisma.entrega.updateMany({
        where: { orderId: o.id, fecha: new Date('2026-10-02') },
        data: { estado: 'ENTREGADA' },
      });
      const r = await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 5])],
      }).expect(200);
      expect(r.body.pedido).toMatchObject({
        estado: { codigo: 'EN_PROCESO', etiqueta: 'En proceso' },
        modificadoPorCliente: true,
      });
      const fri = (await orden(folio)).entregas.find(
        (x) => x.fecha.toISOString().slice(0, 10) === '2026-10-02',
      )!;
      expect(fri.estado).toBe('ENTREGADA');
    });

    it('la nota sola enciende la marca, sin regresar el estado ni tocar las entregas', async () => {
      const { cookie, folio } = await preparar();
      await poner(folio, { estadoPedido: 'CONFIRMADO_SURTIENDO' });
      const r = await modificar(cookie, folio, {
        notaCliente: 'Dejar con el guardia',
      }).expect(200);
      expect(r.body.pedido).toMatchObject({
        estado: { codigo: 'CONFIRMADO_SURTIENDO' },
        notaCliente: 'Dejar con el guardia',
        modificadoPorCliente: true,
        subtotal: 255.5,
      });
    });

    it('sin cambios reales: 200, cambio=false, sin marca y sin tocar el pedido', async () => {
      const { cookie, folio } = await preparar();
      const antes = await orden(folio);
      const r = await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 3])], // igual a lo que ya hay
      }).expect(200);
      expect(r.body.cambio).toBe(false);
      const despues = await orden(folio);
      expect(despues.modificadoPorClienteAt).toBeNull();
      expect(despues.updatedAt.getTime()).toBe(antes.updatedAt.getTime());
    });

    it('lista y detalle del portal muestran la marca; un pedido cancelado no', async () => {
      const { cookie, folio } = await preparar();
      await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 4])],
      }).expect(200);
      const l = await http()
        .get(`/portal/pedidos?slug=${slug()}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(l.body.activos[0].modificadoPorCliente).toBe(true);
      await poner(folio, { cancelado: true });
      expect((await detalle(cookie, folio)).body.modificadoPorCliente).toBe(
        false,
      );
    });
  });

  // ------------------------------------------------------------------ reconfirmación y panel
  describe('reconfirmar y revisar desde el panel', () => {
    it('reconfirmar apaga la marca y reenvía la notificación de Confirmado', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await gerente().patch(`/pedidos-b2b/${o.id}/avanzar`).expect(200);
      expect(s.h.fakes.dispararSeguro).toHaveBeenCalledTimes(1);

      await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 4])],
      }).expect(200);
      expect((await orden(folio)).estadoPedido).toBe('PENDIENTE_CONFIRMACION');
      expect((await orden(folio)).modificadoPorClienteAt).not.toBeNull();
      // Modificar desde el portal no notifica a nadie.
      expect(s.h.fakes.dispararSeguro).toHaveBeenCalledTimes(1);

      const r = await gerente()
        .patch(`/pedidos-b2b/${o.id}/avanzar`)
        .expect(200);
      expect(r.body.modificadoPorClienteAt).toBeNull();
      expect(s.h.fakes.dispararSeguro).toHaveBeenCalledTimes(2);
      expect(s.h.fakes.dispararSeguro.mock.calls[1][0]).toMatchObject({
        estatus: 'CONFIRMADO_SURTIENDO',
        origen: 'PEDIDO_B2B',
      });
    });

    it('el panel ve la marca en la lista y en el detalle; editar no la apaga; «Marcar como revisado» sí (3 roles)', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await poner(folio, { estadoPedido: 'EN_PROCESO' });
      await s.h.prisma.entrega.updateMany({
        where: { orderId: o.id, fecha: new Date('2026-10-02') },
        data: { estado: 'ENTREGADA' },
      });
      await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 4])],
      }).expect(200);

      const lista = await gerente().get('/pedidos-b2b?limit=50').expect(200);
      expect(
        lista.body.data.find((p: any) => p.folio === folio)
          .modificadoPorClienteAt,
      ).not.toBeNull();
      const det = await gerente().get(`/pedidos-b2b/${o.id}`).expect(200);
      expect(det.body.modificadoPorClienteAt).not.toBeNull();

      for (const rol of ['OPERADOR', 'GERENTE', 'DUENO'] as const) {
        // Cada rol puede apagarla; se vuelve a encender para el siguiente.
        await s.h.prisma.order.update({
          where: { id: o.id },
          data: { modificadoPorClienteAt: new Date() },
        });
        const r = await apiRol(s.h, s.base, rol)
          .patch(`/pedidos-b2b/${o.id}/marcar-revisado`)
          .expect(200);
        expect(r.body.modificadoPorClienteAt).toBeNull();
        expect(r.body.estado).toBe('EN_PROCESO'); // no cambia nada más
      }
      // Idempotente.
      await gerente().patch(`/pedidos-b2b/${o.id}/marcar-revisado`).expect(200);
    });

    it('un pedido sin marca no la trae en la respuesta del panel (null) y el panel sin version sigue como siempre', async () => {
      const { folio } = await preparar();
      const o = await orden(folio);
      const r = await gerente()
        .patch(`/pedidos-b2b/${o.id}/items`)
        .send({
          items: [
            {
              productId: A(),
              distribucion: [
                { dia: 'VIERNES', cantidad: 5 },
                { dia: 'SABADO', cantidad: 3 },
              ],
            },
          ],
        })
        .expect(200);
      expect(r.body.modificadoPorClienteAt).toBeNull();
      expect(r.body.totalPiezas).toBe(8);
    });
  });

  // ------------------------------------------------------------------ reglas de horas
  describe('reglas de horas (bordes)', () => {
    it('modificar una entrega: válido a exactamente 18 h; un milisegundo después ya no', async () => {
      const { cookie, folio } = await preparar();
      jest.setSystemTime(new Date('2026-10-01T20:00:00.000Z'));
      const ok = await modificar(cookie, folio, {
        entregas: [e('2026-10-02', [A(), 1])],
      }).expect(200);
      expect(ok.body.cambio).toBe(true);

      jest.setSystemTime(new Date('2026-10-01T20:00:00.001Z'));
      const no = await modificar(cookie, folio, {
        entregas: [e('2026-10-02', [A(), 4])],
      }).expect(409);
      expect(no.body.fechas[0]).toMatchObject({
        fecha: '2026-10-02',
        motivo: 'ANTICIPACION_MODIFICAR',
      });
      expect(no.body.message).toMatch(/18 horas/);
    });

    it('agregar un día: válido a exactamente 36 h; un milisegundo después ya no', async () => {
      const { cookie, folio } = await preparar();
      // Viernes 2 es el borde de 36 h para agregar → usamos el domingo 4 con su propio borde:
      // domingo 08:00 CDMX = 2026-10-04T14:00Z; 36 h antes = 2026-10-03T02:00Z.
      jest.setSystemTime(new Date('2026-10-03T02:00:00.000Z'));
      // En ese momento el viernes ya pasó; el sábado 3 queda a 30 h (<36, pero existe: modificable ≥18).
      const ok = await modificar(cookie, folio, {
        entregas: [e('2026-10-04', [B(), 2])],
      }).expect(200);
      expect(ok.body.pedido.entregas.map((x: any) => x.fecha)).toContain(
        '2026-10-04',
      );
    });

    it('agregar un día antes de tiempo → 409 y no se guarda nada', async () => {
      const { cookie, folio } = await preparar();
      jest.setSystemTime(new Date('2026-10-03T02:00:00.001Z'));
      const no = await modificar(cookie, folio, {
        entregas: [e('2026-10-04', [B(), 2])],
      }).expect(409);
      expect(no.body.fechas[0]).toMatchObject({
        fecha: '2026-10-04',
        motivo: 'ANTICIPACION_AGREGAR',
      });
      expect((await orden(folio)).entregas).toHaveLength(2);
    });

    it('entrega cerrada, día pasado y fecha fuera de la semana', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await s.h.prisma.entrega.updateMany({
        where: { orderId: o.id, fecha: new Date('2026-10-02') },
        data: { estado: 'NO_RECOGIDA' },
      });
      const cerrada = await modificar(cookie, folio, {
        entregas: [e('2026-10-02', [A(), 9])],
      }).expect(409);
      expect(cerrada.body.fechas[0].motivo).toBe('ENTREGA_CERRADA');

      const pasado = await modificar(cookie, folio, {
        entregas: [e('2026-09-29', [A(), 1])],
      }).expect(409);
      expect(pasado.body.fechas[0].motivo).toBe('PASADO');

      await modificar(cookie, folio, {
        entregas: [e('2026-10-12', [A(), 1])],
      }).expect(400);
    });

    it('un día bloqueado con contenido idéntico se ignora; mezclado con un cambio permitido, todo o nada', async () => {
      const { cookie, folio } = await preparar();
      jest.setSystemTime(new Date('2026-10-01T21:00:00.000Z')); // viernes ya no se puede modificar
      const r = await modificar(cookie, folio, {
        entregas: [
          e('2026-10-02', [A(), 2], [B(), 1]),
          e('2026-10-03', [A(), 6]),
        ],
      }).expect(200);
      expect(r.body.cambio).toBe(true);

      const mixto = await modificar(cookie, folio, {
        entregas: [e('2026-10-02', [A(), 9]), e('2026-10-03', [A(), 7])],
      }).expect(409);
      expect(mixto.body.fechas).toHaveLength(1);
      const sab = (await orden(folio)).entregas.find(
        (x) => x.fecha.toISOString().slice(0, 10) === '2026-10-03',
      )!;
      const items = await s.h.prisma.entregaItem.findMany({
        where: { entregaId: sab.id },
      });
      expect(items[0].cantidad).toBe(6); // el cambio permitido NO se aplicó
    });
  });

  // ------------------------------------------------------------------ quitar y agregar
  describe('quitar y agregar entregas', () => {
    it('quitar una entrega la borra (no queda Cancelada) y recalcula totales', async () => {
      const { cookie, folio } = await preparar();
      const r = await modificar(cookie, folio, {
        entregas: [e('2026-10-03')],
      }).expect(200);
      expect(r.body.pedido.entregas).toHaveLength(1);
      expect(r.body.pedido.total).toBe(120.5);
      const o = await orden(folio);
      expect(o.entregas.map((x) => x.estado)).toEqual(['PENDIENTE']);
      expect(o.entregas).toHaveLength(1);
      expect(
        await s.h.prisma.entrega.count({
          where: { orderId: o.id, estado: 'CANCELADA' },
        }),
      ).toBe(0);
    });

    it('quitar todas las entregas → 409 (el cliente no cancela el pedido) y no cambia nada', async () => {
      const { cookie, folio } = await preparar();
      const r = await modificar(cookie, folio, {
        entregas: [e('2026-10-02'), e('2026-10-03')],
      }).expect(409);
      expect(r.body.codigo).toBe('ULTIMA_ENTREGA');
      const o = await orden(folio);
      expect(o.entregas).toHaveLength(2);
      expect(o.cancelado).toBe(false);
    });

    it('si quedan entregas cerradas, quitar todas las pendientes deja el pedido Completado', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await poner(folio, { estadoPedido: 'EN_PROCESO' });
      await s.h.prisma.entrega.updateMany({
        where: { orderId: o.id, fecha: new Date('2026-10-02') },
        data: { estado: 'ENTREGADA' },
      });
      const r = await modificar(cookie, folio, {
        entregas: [e('2026-10-03')],
      }).expect(200);
      expect(r.body.pedido.estado.codigo).toBe('COMPLETADO');
    });

    it('agregar un día a un Completado lo regresa a En proceso con la marca', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await poner(folio, { estadoPedido: 'COMPLETADO' });
      await s.h.prisma.entrega.updateMany({
        where: { orderId: o.id },
        data: { estado: 'ENTREGADA' },
      });
      const r = await modificar(cookie, folio, {
        entregas: [e('2026-10-04', [A(), 1])],
      }).expect(200);
      expect(r.body.pedido).toMatchObject({
        estado: { codigo: 'EN_PROCESO' },
        modificadoPorCliente: true,
      });
    });

    it('agregar un producto nuevo y un día nuevo recalcula el total', async () => {
      const { cookie, folio } = await preparar();
      const r = await modificar(cookie, folio, {
        entregas: [e('2026-10-04', [B(), 2])],
      }).expect(200);
      expect(r.body.pedido).toMatchObject({ subtotal: 316.5, total: 316.5 });
      expect(r.body.pedido.entregas).toHaveLength(3);
    });
  });

  // ------------------------------------------------------------------ pago, precios, disponibilidad
  describe('pago, precios y productos', () => {
    it('Pagado: no se modifica (409, nada cambia) y la pantalla lo marca como bloqueado', async () => {
      const { cookie, folio } = await preparar();
      await poner(folio, { estadoPago: 'PAGADO' });
      const r = await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 1])],
      }).expect(409);
      expect(r.body.codigo).toBe('PEDIDO_PAGADO');
      expect((await orden(folio)).modificadoPorClienteAt).toBeNull();
      const est = await http()
        .get(`/portal/pedidos/${folio}/modificar?slug=${slug()}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(est.body.bloqueo.codigo).toBe('PEDIDO_PAGADO');
    });

    it('todas las líneas toman el precio actual del catálogo, incluidas las de entregas cerradas', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      await s.h.prisma.entrega.updateMany({
        where: { orderId: o.id, fecha: new Date('2026-10-02') },
        data: { estado: 'ENTREGADA' },
      });
      await s.h.prisma.product.update({
        where: { id: A() },
        data: { precio: '50.00' },
      });
      const r = await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 3], [B(), 1])],
      }).expect(200);
      // Café 5 × 50 + Concha 2 × 30.50 = 311
      expect(r.body.pedido.subtotal).toBe(311);
    });

    it('un producto no disponible no se puede agregar ni aumentar, pero sí reducir', async () => {
      const { cookie, folio } = await preparar();
      await s.h.prisma.product.update({
        where: { id: B() },
        data: { disponible: false },
      });
      const no = await modificar(cookie, folio, {
        entregas: [e('2026-10-02', [A(), 2], [B(), 2])],
      }).expect(409);
      expect(no.body.codigo).toBe('PRODUCTO_NO_DISPONIBLE');
      await modificar(cookie, folio, {
        entregas: [e('2026-10-02', [A(), 2])],
      }).expect(200); // quita la Concha
    });

    it('el mínimo de piezas guardado en el pedido se respeta', async () => {
      const { cookie, folio } = await preparar();
      await s.h.prisma.detalleB2B.updateMany({
        where: { order: { folio, tipo: 'B2B' } },
        data: { minimoPiezasAplicado: 6 },
      });
      const r = await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 1])],
      }).expect(409);
      expect(r.body.codigo).toBe('MINIMO_PIEZAS');
    });
  });

  // ------------------------------------------------------------------ concurrencia
  describe('concurrencia y versión', () => {
    it('versión vieja del portal → 409 PEDIDO_CAMBIO', async () => {
      const { cookie, folio } = await preparar();
      const v = (await detalle(cookie, folio)).body.version;
      jest.setSystemTime(new Date('2026-09-30T16:00:05.000Z')); // el reloj de la suite está congelado
      await modificar(
        cookie,
        folio,
        {
          entregas: [e('2026-10-03', [A(), 4])],
        },
        v,
      ).expect(200);
      const r = await modificar(
        cookie,
        folio,
        {
          entregas: [e('2026-10-03', [A(), 5])],
        },
        v,
      ).expect(409);
      expect(r.body.codigo).toBe('PEDIDO_CAMBIO');
    });

    it('dos modificaciones simultáneas con la misma versión: una gana, la otra recibe 409', async () => {
      const { cookie, folio } = await preparar();
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
      const o = await orden(folio);
      const sab = o.entregas.find(
        (x) => x.fecha.toISOString().slice(0, 10) === '2026-10-03',
      )!;
      const items = await s.h.prisma.entregaItem.findMany({
        where: { entregaId: sab.id },
      });
      expect([4, 5]).toContain(items[0].cantidad);
    });

    it('panel con version vieja: 409 con el mensaje acordado y no pisa lo del cliente', async () => {
      const { cookie, folio } = await preparar();
      const o = await orden(folio);
      const vPanel = (await gerente().get(`/pedidos-b2b/${o.id}`).expect(200))
        .body.updatedAt as string;

      jest.setSystemTime(new Date('2026-09-30T16:00:05.000Z'));
      await modificar(cookie, folio, {
        entregas: [e('2026-10-03', [A(), 8])],
      }).expect(200);

      const items = [
        {
          productId: A(),
          distribucion: [
            { dia: 'VIERNES', cantidad: 2 },
            { dia: 'SABADO', cantidad: 3 },
          ],
        },
      ];
      const r = await gerente()
        .patch(`/pedidos-b2b/${o.id}/items`)
        .send({ items, version: vPanel })
        .expect(409);
      expect(r.body.message).toBe(
        'El cliente modificó este pedido mientras lo editabas, recárgalo',
      );
      expect((await orden(folio)).detalleB2b!.totalPiezas).toBe(11);

      // Con la versión vigente sí guarda.
      const vigente = (await gerente().get(`/pedidos-b2b/${o.id}`).expect(200))
        .body.updatedAt as string;
      await gerente()
        .patch(`/pedidos-b2b/${o.id}/items`)
        .send({ items, version: vigente })
        .expect(200);
    });
  });

  // ------------------------------------------------------------------ aislamiento
  describe('aislamiento', () => {
    it('sin sesión → 401; con sesión de otro cliente del mismo negocio → 404 uniforme en GET, PATCH y modificar', async () => {
      const { cookie, folio } = await preparar();
      await http()
        .patch(`/portal/pedidos/${folio}`)
        .set(H)
        .send({ slug: slug(), version: new Date().toISOString(), entregas: [] })
        .expect(401);

      await alta('5511112222', { negocioNombre: 'Sucursal Norte' });
      const otro = await entrar('5511112222');
      const v = (await detalle(cookie, folio)).body.version;
      const patch = await modificar(
        otro,
        folio,
        { entregas: [e('2026-10-03', [A(), 9])] },
        v,
      ).expect(404);
      const inexistente = await modificar(otro, 'P-999999', {}, v).expect(404);
      expect(patch.body.message).toBe(inexistente.body.message);
      await http()
        .get(`/portal/pedidos/${folio}/modificar?slug=${slug()}`)
        .set('Cookie', otro)
        .expect(404);
      expect((await orden(folio)).modificadoPorClienteAt).toBeNull();
    });

    it('otro negocio con el mismo folio → 404; un folio B2C → el mismo 404', async () => {
      const { cookie, folio } = await preparar();
      const otro = await seedBase(s.h.prisma, {
        slug: 'otro-mayoreo',
        tipoStorefront: 'RETAIL_B2B',
      });
      await altaClienteB2bDePrueba(s.h, otro, { contactoTelefono: TEL });
      const cookieOtro = await entrar(TEL, 'otro-mayoreo');
      const v = new Date().toISOString();
      const r = await http()
        .patch(`/portal/pedidos/${folio}`)
        .set(H)
        .set('Cookie', cookieOtro)
        .send({ slug: 'otro-mayoreo', version: v, entregas: [] })
        .expect(404);

      // Orden B2C del mismo cliente con folio "7": el endpoint B2B no la ve.
      const cliente = await s.h.prisma.cliente.findFirstOrThrow({
        where: { tenantId: s.base.tenant.id },
      });
      await s.h.prisma.order.create({
        data: {
          tenantId: s.base.tenant.id,
          folio: '7',
          clienteNombre: 'Cliente B2C',
          clienteTelefono: TEL,
          clienteId: cliente.id,
          tipo: 'B2C',
          total: '10.00',
        },
      });
      const b2c = await http()
        .patch('/portal/pedidos/7')
        .set(H)
        .set('Cookie', cookie)
        .send({ slug: slug(), version: v, entregas: [] })
        .expect(404);
      expect(b2c.body.message).toBe(r.body.message);
      await http()
        .get(`/portal/pedidos/7?slug=${slug()}`)
        .set('Cookie', cookie)
        .expect(404);
    });
  });

  // ------------------------------------------------------------------ pantalla
  describe('GET modificar y pedidos modificables', () => {
    it('devuelve la semana con el estado de cada día y las líneas actuales', async () => {
      const { cookie, folio } = await preparar();
      const r = await http()
        .get(`/portal/pedidos/${folio}/modificar?slug=${slug()}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(r.body.bloqueo).toBeNull();
      expect(r.body.dias).toHaveLength(7);
      const vie = r.body.dias.find((d: any) => d.fecha === '2026-10-02');
      expect(vie).toMatchObject({
        estado: 'MODIFICABLE',
        diaSemana: 'VIERNES',
      });
      expect(vie.entrega.productos).toEqual([
        {
          productId: A(),
          nombre: 'Café americano',
          cantidad: 2,
          precioUnitario: 45,
        },
        { productId: B(), nombre: 'Concha', cantidad: 1, precioUnitario: 30.5 },
      ]);
      expect(
        r.body.dias.find((d: any) => d.fecha === '2026-10-04'),
      ).toMatchObject({
        estado: 'AGREGABLE',
        entrega: null,
      });
      expect(Object.keys(r.body).sort()).toEqual(
        [
          'bloqueo',
          'descuentoPorcentaje',
          'dias',
          'estadoPedido',
          'folio',
          'horasAgregar',
          'horasModificar',
          'minimoPiezas',
          'modificadoPorCliente',
          'notaCliente',
          'numeroAtencion',
          'pagado',
          'semanaFin',
          'semanaInicio',
          'version',
        ].sort(),
      );
    });

    it('pedidos-modificables lista solo los no pagados con algo que cambiar', async () => {
      const { cookie, folio } = await preparar();
      const ok = await http()
        .get(`/portal/pedidos-modificables?slug=${slug()}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(ok.body.pedidos.map((p: any) => p.folio)).toEqual([folio]);
      await poner(folio, { estadoPago: 'PAGADO' });
      const no = await http()
        .get(`/portal/pedidos-modificables?slug=${slug()}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(no.body.pedidos).toEqual([]);
      await http()
        .get(`/portal/pedidos-modificables?slug=${slug()}`)
        .expect(401);
    });

    it('el detalle trae modificable y version', async () => {
      const { cookie, folio } = await preparar();
      const d = (await detalle(cookie, folio)).body;
      expect(d.modificable).toBe(true);
      expect(typeof d.version).toBe('string');
    });
  });
});
