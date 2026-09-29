import request from 'supertest';
import { tokenFor } from './auth';
import { conectarStripe } from './db';
import { auth, crearPedidoTarjeta, eventoPaymentIntent, postWebhook, usarSuite } from './helpers';
import { waitForCalls } from './harness';
import { claves } from './normalizar';

// Área 8 · payments/: lista y CSV (join a order.folio).
describe('B2C · payments', () => {
  const s = usarSuite();
  const api = () => auth(s.h, tokenFor(s.h.jwt, s.base.dueno, s.base.tenant.id, 'DUENO'));

  beforeEach(async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    // folio 1: falla y luego paga (2 filas). folio 2: paga (45). folio 3: falla (45 -> 90 con cantidad 2).
    const p1 = await crearPedidoTarjeta(s.h, s.base, { clienteTelefono: '5511110001' });
    jest.setSystemTime(new Date('2026-09-30T16:10:00.000Z'));
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.payment_failed', p1.piId, 4500)).expect(200);
    jest.setSystemTime(new Date('2026-09-30T16:20:00.000Z'));
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', p1.piId, 4500)).expect(200);
    const p2 = await crearPedidoTarjeta(s.h, s.base, { clienteTelefono: '5511110002' });
    jest.setSystemTime(new Date('2026-09-30T16:30:00.000Z'));
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.succeeded', p2.piId, 4500)).expect(200);
    const p3 = await crearPedidoTarjeta(s.h, s.base, {
      clienteTelefono: '5511110003',
      items: [{ productId: s.base.productoA.id, cantidad: 2 }],
    });
    jest.setSystemTime(new Date('2026-09-30T16:40:00.000Z'));
    await postWebhook(s.h, eventoPaymentIntent('payment_intent.payment_failed', p3.piId, 9000)).expect(200);
    await waitForCalls(s.h.fakes.queueAdd, 4);
  });

  it('lista paginada, más reciente primero; folio aplanado (sin objeto order)', async () => {
    const res = await api().get('/payments').expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['data', 'limit', 'page', 'total', 'totalPages']);
    expect(res.body).toMatchObject({ total: 4, page: 1, limit: 25, totalPages: 1 });
    expect(claves(res.body.data[0])).toEqual([
      'amount',
      'capturedAt',
      'cardBrand',
      'createdAt',
      'currency',
      'folio',
      'id',
      'last4',
      'paymentMethodType',
      'status',
    ]);
    expect(res.body.data.map(({ id, ...r }: any) => r)).toEqual([
      { amount: '90', currency: 'mxn', status: 'FALLIDO', paymentMethodType: 'card', cardBrand: null, last4: null, capturedAt: '2026-09-21T14:13:20.000Z', createdAt: '2026-09-30T16:40:00.000Z', folio: '3' },
      { amount: '45', currency: 'mxn', status: 'PAGADO', paymentMethodType: 'card', cardBrand: null, last4: null, capturedAt: '2026-09-21T14:13:20.000Z', createdAt: '2026-09-30T16:30:00.000Z', folio: '2' },
      { amount: '45', currency: 'mxn', status: 'PAGADO', paymentMethodType: 'card', cardBrand: null, last4: null, capturedAt: '2026-09-21T14:13:20.000Z', createdAt: '2026-09-30T16:20:00.000Z', folio: '1' },
      { amount: '45', currency: 'mxn', status: 'FALLIDO', paymentMethodType: 'card', cardBrand: null, last4: null, capturedAt: '2026-09-21T14:13:20.000Z', createdAt: '2026-09-30T16:10:00.000Z', folio: '1' },
    ]);
  });

  it('filtros: status, método, fechas, importe; paginación', async () => {
    const folios = async (qs: string) => (await api().get(`/payments?${qs}`).expect(200)).body.data.map((p: any) => p.folio);
    expect(await folios('status=FALLIDO')).toEqual(['3', '1']);
    expect(await folios('status=PAGADO')).toEqual(['2', '1']);
    expect(await folios('paymentMethodType=card')).toEqual(['3', '2', '1', '1']);
    expect(await folios('paymentMethodType=oxxo')).toEqual([]);
    expect(await folios('desde=2026-09-30T16:25:00.000Z&hasta=2026-09-30T16:45:00.000Z')).toEqual(['3', '2']);
    expect(await folios('operador=MAYOR_IGUAL&valor=90')).toEqual(['3']);
    expect(await folios('limit=2&page=2')).toEqual(['1', '1']);
  });

  it('CSV: cabeceras y contenido exacto', async () => {
    const res = await api().get('/payments/export').expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="pagos.csv"');
    expect(res.text).toMatchSnapshot();
  });

  it('abierto a los 3 roles; sin token 401', async () => {
    await auth(s.h, tokenFor(s.h.jwt, s.base.operador, s.base.tenant.id, 'OPERADOR')).get('/payments').expect(200);
    await request(s.h.app.getHttpServer()).get('/payments').expect(401);
  });
});
