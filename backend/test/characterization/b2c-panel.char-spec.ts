import request from 'supertest';
import { auth, usarSuite } from './helpers';
import { normalizar } from './normalizar';
import { crearEscenarioPanel, Escenario, HOY } from './escenario-panel';
import { clienteEsperado, expectError, itemEsperado, ordenEsperada } from './exacto';

// Área 5 · Panel: findAll, findOne, histórico, CSV, summary*, clientes (summaryDaily, activos, lista).
// Todas las respuestas con igualdad estricta (claves + valores; ids y fechas normalizados).

/** Pedidos del escenario tal como los devuelve findAll/findOne (items SIN `modificadores`). */
const PEDIDOS: Record<string, Record<string, unknown>> = {
  '5': ordenEsperada({
    id: '<order5>', folio: '5', clienteNombre: 'Diego Prueba', clienteTelefono: '5566667777', clienteId: '<cliente:5566667777>',
    metodoPago: 'TARJETA', estadoPago: 'PAGADO', stripePaymentIntentId: 'pi_char_2', estadoPedido: 'CONFIRMADO_SURTIENDO', total: '30.5',
    items: [itemEsperado({ orderId: '<order5>', productId: '<productoB>', nombreProducto: 'Concha', precioUnitario: '30.5' })],
  }),
  '4': ordenEsperada({
    id: '<order4>', folio: '4', clienteNombre: 'Carla Prueba', clienteTelefono: '5544445555', clienteCorreo: 'carla@test.com',
    clienteId: '<cliente:5544445555>', metodoPago: 'TARJETA', estadoPago: 'PENDIENTE', stripePaymentIntentId: 'pi_char_1', total: '45',
    items: [itemEsperado({ orderId: '<order4>' })],
  }),
  '3': ordenEsperada({
    id: '<order3>', folio: '3', clienteNombre: 'Ana Prueba', clienteTelefono: '5511112222', clienteId: '<cliente:5511112222>', total: '90',
    items: [itemEsperado({ orderId: '<order3>', cantidad: 2 })],
  }),
  '2': ordenEsperada({
    id: '<order2>', folio: '2', clienteNombre: 'Beto Prueba', clienteTelefono: '5522223333', clienteId: '<cliente:5522223333>',
    estadoPedido: 'CONFIRMADO_SURTIENDO', total: '61',
    items: [itemEsperado({ orderId: '<order2>', productId: '<productoB>', nombreProducto: 'Concha', precioUnitario: '30.5', cantidad: 2 })],
  }),
  '1': ordenEsperada({
    id: '<order1>', folio: '1', clienteNombre: 'Ana Prueba', clienteTelefono: '5511112222', clienteId: '<cliente:5511112222>',
    estadoPedido: 'DESPACHADO', total: '45',
    items: [itemEsperado({ orderId: '<order1>' })],
  }),
};
const pedidos = (...folios: string[]) => folios.map((f) => PEDIDOS[f]);

/** Fila del histórico (id se quita antes de comparar). */
const fila = (folio: string, clienteNombre: string, estadoPedido: string, metodoPago: string, total: string, createdAt: string) => ({
  folio, clienteNombre, estadoPedido, metodoPago, total, createdAt,
});
const HIST: Record<string, ReturnType<typeof fila>> = {
  '5': fila('5', 'Diego Prueba', 'CONFIRMADO_SURTIENDO', 'TARJETA', '30.5', '2026-09-30T18:00:00.000Z'),
  '4': fila('4', 'Carla Prueba', 'PENDIENTE_CONFIRMACION', 'TARJETA', '45', '2026-09-30T17:00:00.000Z'),
  '3': fila('3', 'Ana Prueba', 'PENDIENTE_CONFIRMACION', 'EFECTIVO', '90', '2026-09-30T16:00:00.000Z'),
  '2': fila('2', 'Beto Prueba', 'CONFIRMADO_SURTIENDO', 'EFECTIVO', '61', '2026-09-29T15:00:00.000Z'),
  '1': fila('1', 'Ana Prueba', 'DESPACHADO', 'EFECTIVO', '45', '2026-09-28T15:00:00.000Z'),
};
const hist = (...folios: string[]) => folios.map((f) => HIST[f]);

describe('B2C · panel', () => {
  const s = usarSuite();
  let e: Escenario;
  const api = () => auth(s.h, e.tokenDueno);

  beforeEach(async () => {
    e = await crearEscenarioPanel(s);
  });

  /** Etiquetas de ids según el propio cuerpo de findAll: order<folio> y cliente:<teléfono>. */
  function etiquetas(ordenes: any[]): Record<string, string> {
    const et: Record<string, string> = { [s.base.tenant.id]: 'tenant', [s.base.productoA.id]: 'productoA', [s.base.productoB.id]: 'productoB' };
    for (const o of ordenes) {
      et[o.id] = `order${o.folio}`;
      et[o.clienteId] = `cliente:${o.clienteTelefono}`;
    }
    return et;
  }
  const exacto = (body: any[], esperado: unknown[]) => expect(normalizar(body, etiquetas(body))).toStrictEqual(esperado);
  const exactoUno = (body: any, esperado: unknown) => expect(normalizar(body, etiquetas([body]))).toStrictEqual(esperado);

  describe('GET /orders', () => {
    it('lista todo (incluido el pedido TARJETA aún sin pagar) más reciente primero, con la forma completa', async () => {
      const res = await api().get('/orders').expect(200);
      exacto(res.body, pedidos('5', '4', '3', '2', '1'));
      // BUG CONGELADO: el pedido 4 (TARJETA, estadoPago PENDIENTE, nunca pagado) aparece como activo
      // — está en la lista exacta de arriba (PEDIDOS['4']).
    });

    it('filtra por estadoPedido', async () => {
      exacto((await api().get('/orders?estadoPedido=DESPACHADO').expect(200)).body, pedidos('1'));
      exacto((await api().get('/orders?estadoPedido=CONFIRMADO_SURTIENDO').expect(200)).body, pedidos('5', '2'));
      exacto((await api().get('/orders?estadoPedido=LISTO_ENTREGA').expect(200)).body, []);
    });

    it('filtra por rango de fechas', async () => {
      const res = await api().get(`/orders?desde=${HOY.desde}&hasta=${HOY.hasta}`).expect(200);
      exacto(res.body, pedidos('5', '4', '3'));
    });

    it('estadoPedido inválido: 400', async () => {
      const res = await api().get('/orders?estadoPedido=NOPE');
      expectError(res, 400, [
        'estadoPedido must be one of the following values: PENDIENTE_CONFIRMACION, CONFIRMADO_SURTIENDO, LISTO_ENTREGA, DESPACHADO',
      ]);
    });

    it('sin token: 401 exacto; los 3 roles pueden leer la misma lista', async () => {
      expectError(await request(s.h.app.getHttpServer()).get('/orders'), 401, 'Unauthorized');
      exacto((await auth(s.h, e.tokenOperador).get('/orders').expect(200)).body, pedidos('5', '4', '3', '2', '1'));
      exacto((await auth(s.h, e.tokenGerente).get('/orders').expect(200)).body, pedidos('5', '4', '3', '2', '1'));
    });
  });

  describe('GET /orders/:id', () => {
    it('devuelve la orden con items (sin modificadores) y 404 si no existe', async () => {
      const res = await api().get(`/orders/${e.ids.o3}`).expect(200);
      // etiquetas necesitan el resto de pedidos solo para los ids; aquí basta con el propio cuerpo.
      exactoUno(res.body, PEDIDOS['3']);

      expectError(await api().get('/orders/00000000-0000-4000-8000-000000000000'), 404, 'Pedido no encontrado');
    });
  });

  describe('GET /orders/historico', () => {
    const conFila = async (qs = '') => {
      const res = await api().get(`/orders/historico${qs ? `?${qs}` : ''}`).expect(200);
      return { res, filas: normalizar(res.body.data.map(({ id, ...resto }: any) => resto)) };
    };

    it('forma paginada exacta y columnas mínimas por fila', async () => {
      const { res, filas } = await conFila();
      expect(Object.keys(res.body).sort()).toEqual(['data', 'limit', 'page', 'total', 'totalPages']);
      expect({ total: res.body.total, page: res.body.page, limit: res.body.limit, totalPages: res.body.totalPages }).toStrictEqual({
        total: 5,
        page: 1,
        limit: 25,
        totalPages: 1,
      });
      // Conjunto exacto de claves de cada fila (incluye `id`) y valores exactos.
      expect(res.body.data.map((f: any) => Object.keys(f).sort())).toStrictEqual(
        Array(5).fill(['clienteNombre', 'createdAt', 'estadoPedido', 'folio', 'id', 'metodoPago', 'total']),
      );
      expect(res.body.data.map((f: any) => f.createdAt)).toStrictEqual(hist('5', '4', '3', '2', '1').map((f) => f.createdAt));
      expect(filas).toStrictEqual(hist('5', '4', '3', '2', '1').map((f) => ({ ...f, createdAt: '<iso>' })));
    });

    it('filtros: estadoPedido, metodoPago, fechas, importe (MAYOR_IGUAL / ENTRE)', async () => {
      const filasDe = async (qs: string) => (await conFila(qs)).res.body.data.map(({ id, ...r }: any) => r);
      expect(await filasDe('estadoPedido=DESPACHADO')).toStrictEqual(hist('1'));
      expect(await filasDe('metodoPago=TARJETA')).toStrictEqual(hist('5', '4'));
      expect(await filasDe(`desde=${HOY.desde}&hasta=${HOY.hasta}`)).toStrictEqual(hist('5', '4', '3'));
      expect(await filasDe('operador=MAYOR_IGUAL&valor=60')).toStrictEqual(hist('3', '2'));
      expect(await filasDe('operador=ENTRE&valor=40&valorHasta=61')).toStrictEqual(hist('4', '2', '1'));
      expect(await filasDe('metodoPago=EFECTIVO&operador=MENOR_IGUAL&valor=61')).toStrictEqual(hist('2', '1'));
    });

    it('paginación', async () => {
      const res = await api().get('/orders/historico?limit=2&page=2').expect(200);
      expect({ total: res.body.total, page: res.body.page, limit: res.body.limit, totalPages: res.body.totalPages }).toStrictEqual({
        total: 5,
        page: 2,
        limit: 2,
        totalPages: 3,
      });
      expect(res.body.data.map(({ id, ...r }: any) => r)).toStrictEqual(hist('3', '2'));
    });

    it('validación: limit > 100 y operador sin valor', async () => {
      expectError(await api().get('/orders/historico?limit=101'), 400, ['limit must not be greater than 100']);
      expectError(await api().get('/orders/historico?operador=MAYOR_IGUAL'), 400, [
        'valor must be a number conforming to the specified constraints',
      ]);
    });
  });

  describe('GET /orders/historico/export (CSV)', () => {
    it('cabeceras y contenido exacto (orden de columnas)', async () => {
      const res = await api().get('/orders/historico/export').expect(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toBe('attachment; filename="pedidos-historico.csv"');
      expect(res.text).toMatchSnapshot();
    });

    it('respeta los filtros', async () => {
      const res = await api().get('/orders/historico/export?estadoPedido=DESPACHADO').expect(200);
      expect(res.text.split('\n').slice(1)).toStrictEqual(['1,Ana Prueba,2026-09-28T15:00:00.000Z,DESPACHADO,EFECTIVO,45.00']);
    });
  });

  describe('resúmenes (valores exactos con reloj fijo)', () => {
    it('GET /orders/summary: BUG CONGELADO — el pedido TARJETA sin pagar cuenta como ingreso', async () => {
      const res = await api().get(`/orders/summary?desde=${HOY.desde}&hasta=${HOY.hasta}`).expect(200);
      // hoy: o3 (90) + o4 (45, TARJETA PENDIENTE de pago) + o5 (30.5) = 165.5 en 3 pedidos
      expect(res.body).toStrictEqual({
        pedidosHoy: 3,
        ingresosHoy: '165.50',
        ticketPromedioHoy: '55.17',
        promocionesActivas: 0,
      });
    });

    it('GET /orders/summary sin pedidos: ceros con formato', async () => {
      const res = await api().get('/orders/summary?desde=2026-01-01T06:00:00.000Z&hasta=2026-01-02T05:59:59.999Z').expect(200);
      expect(res.body).toStrictEqual({ pedidosHoy: 0, ingresosHoy: '0.00', ticketPromedioHoy: '0.00', promocionesActivas: 0 });
    });

    it('GET /orders/summary/daily: 10 días terminando hoy', async () => {
      const res = await api().get(`/orders/summary/daily?desde=${HOY.desde}&hasta=${HOY.hasta}`).expect(200);
      expect(res.body).toStrictEqual([
        { fecha: '2026-09-21', pedidos: 0 },
        { fecha: '2026-09-22', pedidos: 0 },
        { fecha: '2026-09-23', pedidos: 0 },
        { fecha: '2026-09-24', pedidos: 0 },
        { fecha: '2026-09-25', pedidos: 0 },
        { fecha: '2026-09-26', pedidos: 0 },
        { fecha: '2026-09-27', pedidos: 0 },
        { fecha: '2026-09-28', pedidos: 1 },
        { fecha: '2026-09-29', pedidos: 1 },
        { fecha: '2026-09-30', pedidos: 3 },
      ]);
    });

    it('GET /orders/summary/estatus: siempre los 4 estados, incluso en 0', async () => {
      const hoy = await api().get(`/orders/summary/estatus?desde=${HOY.desde}&hasta=${HOY.hasta}`).expect(200);
      expect(hoy.body).toStrictEqual([
        { estadoPedido: 'PENDIENTE_CONFIRMACION', conteo: 2 },
        { estadoPedido: 'CONFIRMADO_SURTIENDO', conteo: 1 },
        { estadoPedido: 'LISTO_ENTREGA', conteo: 0 },
        { estadoPedido: 'DESPACHADO', conteo: 0 },
      ]);
      const tres = await api()
        .get('/orders/summary/estatus?desde=2026-09-28T06:00:00.000Z&hasta=2026-10-01T05:59:59.999Z')
        .expect(200);
      expect(tres.body).toStrictEqual([
        { estadoPedido: 'PENDIENTE_CONFIRMACION', conteo: 2 },
        { estadoPedido: 'CONFIRMADO_SURTIENDO', conteo: 2 },
        { estadoPedido: 'LISTO_ENTREGA', conteo: 0 },
        { estadoPedido: 'DESPACHADO', conteo: 1 },
      ]);
    });

    it('validación: summary sin fechas = 400 con el detalle exacto', async () => {
      expectError(await api().get('/orders/summary'), 400, [
        'desde must be a valid ISO 8601 date string',
        'hasta must be a valid ISO 8601 date string',
      ]);
    });
  });

  describe('clientes', () => {
    const clientes = {
      diego: clienteEsperado({ telefono: '5566667777', nombre: 'Diego Prueba' }),
      carla: clienteEsperado({ telefono: '5544445555', nombre: 'Carla Prueba', correo: 'carla@test.com' }),
      ana: clienteEsperado({ telefono: '5511112222', nombre: 'Ana Prueba', totalPedidos: 2 }),
      beto: clienteEsperado({ telefono: '5522223333', nombre: 'Beto Prueba' }),
    };
    const pagina = (body: any) => ({ total: body.total, page: body.page, limit: body.limit, totalPages: body.totalPages });
    const norm = (v: unknown) => normalizar(v, { [s.base.tenant.id]: 'tenant' });

    it('GET /clientes: forma paginada exacta, orden por último pedido desc', async () => {
      const res = await api().get('/clientes').expect(200);
      expect(Object.keys(res.body).sort()).toEqual(['data', 'limit', 'page', 'total', 'totalPages']);
      expect(pagina(res.body)).toStrictEqual({ total: 4, page: 1, limit: 25, totalPages: 1 });
      expect(norm(res.body.data)).toStrictEqual([clientes.diego, clientes.carla, clientes.ana, clientes.beto]);
    });

    it('ordenar por totalPedidos, búsqueda por nombre y por teléfono (con formato), paginación', async () => {
      const top = await api().get('/clientes?ordenarPor=totalPedidos&orden=desc&limit=1').expect(200);
      expect(pagina(top.body)).toStrictEqual({ total: 4, page: 1, limit: 1, totalPages: 4 });
      expect(norm(top.body.data)).toStrictEqual([clientes.ana]);
      const q1 = await api().get('/clientes?q=carla').expect(200);
      expect(pagina(q1.body)).toStrictEqual({ total: 1, page: 1, limit: 25, totalPages: 1 });
      expect(norm(q1.body.data)).toStrictEqual([clientes.carla]);
      const q2 = await api().get(`/clientes?q=${encodeURIComponent('55 4444')}`).expect(200);
      expect(norm(q2.body.data)).toStrictEqual([clientes.carla]);
    });

    it('GET /clientes/summary/daily: nuevos vs. recurrentes por día (clientes distintos, no pedidos)', async () => {
      const res = await api().get(`/clientes/summary/daily?desde=${HOY.desde}&hasta=${HOY.hasta}`).expect(200);
      expect(res.body).toStrictEqual([
        ...['21', '22', '23', '24', '25', '26', '27'].map((d) => ({ fecha: `2026-09-${d}`, nuevos: 0, recurrentes: 0 })),
        { fecha: '2026-09-28', nuevos: 1, recurrentes: 0 },
        { fecha: '2026-09-29', nuevos: 1, recurrentes: 0 },
        { fecha: '2026-09-30', nuevos: 2, recurrentes: 1 }, // Carla, Diego nuevos; Ana recurrente
      ]);
    });

    it('GET /clientes/activos: clientes con pedido en los últimos 7 días', async () => {
      const res = await api().get('/clientes/activos').expect(200);
      expect(res.body).toStrictEqual({ clientesActivos: 4 });
    });

    it('los 3 roles pueden leer /clientes; sin token 401 exacto', async () => {
      const op = await auth(s.h, e.tokenOperador).get('/clientes').expect(200);
      expect(norm(op.body.data)).toStrictEqual([clientes.diego, clientes.carla, clientes.ana, clientes.beto]);
      expectError(await request(s.h.app.getHttpServer()).get('/clientes'), 401, 'Unauthorized');
    });
  });
});
