import { auth, CLAVES_ITEM, CLAVES_ORDER, usarSuite } from './helpers';
import { claves } from './normalizar';
import { crearEscenarioPanel, Escenario, HOY } from './escenario-panel';
import request from 'supertest';

// Área 5 · Panel: findAll, findOne, histórico, CSV, summary*, clientes (summaryDaily, activos, lista).
describe('B2C · panel', () => {
  const s = usarSuite();
  let e: Escenario;
  const api = () => auth(s.h, e.tokenDueno);

  beforeEach(async () => {
    e = await crearEscenarioPanel(s);
  });

  describe('GET /orders', () => {
    it('lista todo (incluido el pedido TARJETA aún sin pagar) más reciente primero, con la forma completa', async () => {
      const res = await api().get('/orders').expect(200);
      expect(res.body.map((o: any) => o.folio)).toEqual(['5', '4', '3', '2', '1']);
      for (const o of res.body) {
        expect(claves(o)).toEqual(CLAVES_ORDER);
        expect(claves(o.items[0])).toEqual(CLAVES_ITEM); // sin `modificadores` aquí (include: items)
      }
      // BUG CONGELADO: el pedido 4 (TARJETA, estadoPago PENDIENTE, nunca pagado) aparece como activo.
      const o4 = res.body.find((o: any) => o.folio === '4');
      expect(o4).toMatchObject({ metodoPago: 'TARJETA', estadoPago: 'PENDIENTE', estadoPedido: 'PENDIENTE_CONFIRMACION' });
    });

    it('filtra por estadoPedido', async () => {
      const res = await api().get('/orders?estadoPedido=DESPACHADO').expect(200);
      expect(res.body.map((o: any) => o.folio)).toEqual(['1']);
      const conf = await api().get('/orders?estadoPedido=CONFIRMADO_SURTIENDO').expect(200);
      expect(conf.body.map((o: any) => o.folio)).toEqual(['5', '2']);
    });

    it('filtra por rango de fechas', async () => {
      const res = await api().get(`/orders?desde=${HOY.desde}&hasta=${HOY.hasta}`).expect(200);
      expect(res.body.map((o: any) => o.folio)).toEqual(['5', '4', '3']);
    });

    it('estadoPedido inválido: 400', async () => {
      const res = await api().get('/orders?estadoPedido=NOPE').expect(400);
      expect(res.body.message).toEqual([
        'estadoPedido must be one of the following values: PENDIENTE_CONFIRMACION, CONFIRMADO_SURTIENDO, LISTO_ENTREGA, DESPACHADO',
      ]);
    });

    it('sin token: 401; los 3 roles pueden leer', async () => {
      await request(s.h.app.getHttpServer()).get('/orders').expect(401);
      await auth(s.h, e.tokenOperador).get('/orders').expect(200);
      await auth(s.h, e.tokenGerente).get('/orders').expect(200);
    });
  });

  describe('GET /orders/:id', () => {
    it('devuelve la orden con items (sin modificadores) y 404 si no existe', async () => {
      const res = await api().get(`/orders/${e.ids.o3}`).expect(200);
      expect(claves(res.body)).toEqual(CLAVES_ORDER);
      expect(res.body).toMatchObject({ folio: '3', total: '90', clienteNombre: 'Ana Prueba' });
      expect(res.body.items).toHaveLength(1);

      const nf = await api().get('/orders/00000000-0000-4000-8000-000000000000').expect(404);
      expect(nf.body).toEqual({ message: 'Pedido no encontrado', error: 'Not Found', statusCode: 404 });
    });
  });

  describe('GET /orders/historico', () => {
    const fila = (folio: string, clienteNombre: string, estadoPedido: string, metodoPago: string, total: string, createdAt: string) => ({
      folio,
      clienteNombre,
      estadoPedido,
      metodoPago,
      total,
      createdAt,
    });

    it('forma paginada y columnas mínimas por fila', async () => {
      const res = await api().get('/orders/historico').expect(200);
      expect(Object.keys(res.body).sort()).toEqual(['data', 'limit', 'page', 'total', 'totalPages']);
      expect(res.body).toMatchObject({ total: 5, page: 1, limit: 25, totalPages: 1 });
      expect(claves(res.body.data[0])).toEqual(['clienteNombre', 'createdAt', 'estadoPedido', 'folio', 'id', 'metodoPago', 'total']);
      expect(res.body.data.map(({ id, ...resto }: any) => resto)).toEqual([
        fila('5', 'Diego Prueba', 'CONFIRMADO_SURTIENDO', 'TARJETA', '30.5', '2026-09-30T18:00:00.000Z'),
        fila('4', 'Carla Prueba', 'PENDIENTE_CONFIRMACION', 'TARJETA', '45', '2026-09-30T17:00:00.000Z'),
        fila('3', 'Ana Prueba', 'PENDIENTE_CONFIRMACION', 'EFECTIVO', '90', '2026-09-30T16:00:00.000Z'),
        fila('2', 'Beto Prueba', 'CONFIRMADO_SURTIENDO', 'EFECTIVO', '61', '2026-09-29T15:00:00.000Z'),
        fila('1', 'Ana Prueba', 'DESPACHADO', 'EFECTIVO', '45', '2026-09-28T15:00:00.000Z'),
      ]);
    });

    it('filtros: estadoPedido, metodoPago, fechas, importe (MAYOR_IGUAL / ENTRE)', async () => {
      const folios = async (qs: string) => (await api().get(`/orders/historico?${qs}`).expect(200)).body.data.map((o: any) => o.folio);
      expect(await folios('estadoPedido=DESPACHADO')).toEqual(['1']);
      expect(await folios('metodoPago=TARJETA')).toEqual(['5', '4']);
      expect(await folios(`desde=${HOY.desde}&hasta=${HOY.hasta}`)).toEqual(['5', '4', '3']);
      expect(await folios('operador=MAYOR_IGUAL&valor=60')).toEqual(['3', '2']);
      expect(await folios('operador=ENTRE&valor=40&valorHasta=61')).toEqual(['4', '2', '1']);
      expect(await folios('metodoPago=EFECTIVO&operador=MENOR_IGUAL&valor=61')).toEqual(['2', '1']);
    });

    it('paginación', async () => {
      const p2 = await api().get('/orders/historico?limit=2&page=2').expect(200);
      expect(p2.body).toMatchObject({ total: 5, page: 2, limit: 2, totalPages: 3 });
      expect(p2.body.data.map((o: any) => o.folio)).toEqual(['3', '2']);
    });

    it('validación: limit > 100 y operador sin valor', async () => {
      const a = await api().get('/orders/historico?limit=101').expect(400);
      expect(a.body.message).toEqual(['limit must not be greater than 100']);
      const b = await api().get('/orders/historico?operador=MAYOR_IGUAL').expect(400);
      expect(b.body.message).toEqual(['valor must be a number conforming to the specified constraints']);
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
      expect(res.text.trim().split('\n')).toHaveLength(2); // encabezado + 1 fila
    });
  });

  describe('resúmenes (valores exactos con reloj fijo)', () => {
    it('GET /orders/summary: BUG CONGELADO — el pedido TARJETA sin pagar cuenta como ingreso', async () => {
      const res = await api().get(`/orders/summary?desde=${HOY.desde}&hasta=${HOY.hasta}`).expect(200);
      // hoy: o3 (90) + o4 (45, TARJETA PENDIENTE de pago) + o5 (30.5) = 165.5 en 3 pedidos
      expect(res.body).toEqual({
        pedidosHoy: 3,
        ingresosHoy: '165.50',
        ticketPromedioHoy: '55.17',
        promocionesActivas: 0,
      });
    });

    it('GET /orders/summary sin pedidos: ceros con formato', async () => {
      const res = await api().get('/orders/summary?desde=2026-01-01T06:00:00.000Z&hasta=2026-01-02T05:59:59.999Z').expect(200);
      expect(res.body).toEqual({ pedidosHoy: 0, ingresosHoy: '0.00', ticketPromedioHoy: '0.00', promocionesActivas: 0 });
    });

    it('GET /orders/summary/daily: 10 días terminando hoy', async () => {
      const res = await api().get(`/orders/summary/daily?desde=${HOY.desde}&hasta=${HOY.hasta}`).expect(200);
      expect(res.body).toEqual([
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
      expect(hoy.body).toEqual([
        { estadoPedido: 'PENDIENTE_CONFIRMACION', conteo: 2 },
        { estadoPedido: 'CONFIRMADO_SURTIENDO', conteo: 1 },
        { estadoPedido: 'LISTO_ENTREGA', conteo: 0 },
        { estadoPedido: 'DESPACHADO', conteo: 0 },
      ]);
      const tres = await api()
        .get('/orders/summary/estatus?desde=2026-09-28T06:00:00.000Z&hasta=2026-10-01T05:59:59.999Z')
        .expect(200);
      expect(tres.body).toEqual([
        { estadoPedido: 'PENDIENTE_CONFIRMACION', conteo: 2 },
        { estadoPedido: 'CONFIRMADO_SURTIENDO', conteo: 2 },
        { estadoPedido: 'LISTO_ENTREGA', conteo: 0 },
        { estadoPedido: 'DESPACHADO', conteo: 1 },
      ]);
    });

    it('validación: summary sin fechas = 400', async () => {
      await api().get('/orders/summary').expect(400);
    });
  });

  describe('clientes', () => {
    it('GET /clientes: forma paginada, orden por último pedido desc y forma de cada Cliente', async () => {
      const res = await api().get('/clientes').expect(200);
      expect(Object.keys(res.body).sort()).toEqual(['data', 'limit', 'page', 'total', 'totalPages']);
      expect(res.body).toMatchObject({ total: 4, page: 1, limit: 25, totalPages: 1 });
      expect(claves(res.body.data[0])).toEqual([
        'canal',
        'correo',
        'createdAt',
        'id',
        'nombre',
        'primerPedidoAt',
        'telefono',
        'tenantId',
        'totalPedidos',
        'ultimoPedidoAt',
        'updatedAt',
      ]);
      expect(res.body.data.map((c: any) => [c.nombre, c.totalPedidos, c.canal])).toEqual([
        ['Diego Prueba', 1, 'B2C'],
        ['Carla Prueba', 1, 'B2C'],
        ['Ana Prueba', 2, 'B2C'],
        ['Beto Prueba', 1, 'B2C'],
      ]);
    });

    it('ordenar por totalPedidos, búsqueda por nombre y por teléfono (con formato), paginación', async () => {
      const top = await api().get('/clientes?ordenarPor=totalPedidos&orden=desc&limit=1').expect(200);
      expect(top.body).toMatchObject({ total: 4, limit: 1, totalPages: 4 });
      expect(top.body.data[0].nombre).toBe('Ana Prueba');
      const q1 = await api().get('/clientes?q=carla').expect(200);
      expect(q1.body.data.map((c: any) => c.nombre)).toEqual(['Carla Prueba']);
      const q2 = await api().get(`/clientes?q=${encodeURIComponent('55 4444')}`).expect(200);
      expect(q2.body.data.map((c: any) => c.nombre)).toEqual(['Carla Prueba']);
    });

    it('GET /clientes/summary/daily: nuevos vs. recurrentes por día (clientes distintos, no pedidos)', async () => {
      const res = await api().get(`/clientes/summary/daily?desde=${HOY.desde}&hasta=${HOY.hasta}`).expect(200);
      expect(res.body.slice(-3)).toEqual([
        { fecha: '2026-09-28', nuevos: 1, recurrentes: 0 },
        { fecha: '2026-09-29', nuevos: 1, recurrentes: 0 },
        { fecha: '2026-09-30', nuevos: 2, recurrentes: 1 }, // Carla, Diego nuevos; Ana recurrente
      ]);
      expect(res.body).toHaveLength(10);
      expect(res.body.slice(0, 7).every((d: any) => d.nuevos === 0 && d.recurrentes === 0)).toBe(true);
    });

    it('GET /clientes/activos: clientes con pedido en los últimos 7 días', async () => {
      const res = await api().get('/clientes/activos').expect(200);
      expect(res.body).toEqual({ clientesActivos: 4 });
    });

    it('los 3 roles pueden leer /clientes; sin token 401', async () => {
      await auth(s.h, e.tokenOperador).get('/clientes').expect(200);
      await request(s.h.app.getHttpServer()).get('/clientes').expect(401);
    });
  });
});
