import request from 'supertest';
import { tokenFor } from './auth';
import { conectarStripe } from './db';
import { expectError } from './exacto';
import { auth, crearPedidoTarjeta, eventoPaymentIntent, postWebhook, usarSuite } from './helpers';
import { waitForCalls } from './harness';

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
    expect({ total: res.body.total, page: res.body.page, limit: res.body.limit, totalPages: res.body.totalPages }).toStrictEqual({ total: 4, page: 1, limit: 25, totalPages: 1 });
    // Cada fila: id + las 9 claves restantes (toStrictEqual sobre el objeto completo)
    expect(res.body.data.map((r: any) => typeof r.id)).toStrictEqual(Array(4).fill('string'));
    expect(res.body.data.map(({ id, ...r }: any) => r)).toStrictEqual([
      { amount: '90', currency: 'mxn', status: 'FALLIDO', paymentMethodType: 'card', cardBrand: null, last4: null, capturedAt: '2026-09-21T14:13:20.000Z', createdAt: '2026-09-30T16:40:00.000Z', folio: '3' },
      { amount: '45', currency: 'mxn', status: 'PAGADO', paymentMethodType: 'card', cardBrand: null, last4: null, capturedAt: '2026-09-21T14:13:20.000Z', createdAt: '2026-09-30T16:30:00.000Z', folio: '2' },
      { amount: '45', currency: 'mxn', status: 'PAGADO', paymentMethodType: 'card', cardBrand: null, last4: null, capturedAt: '2026-09-21T14:13:20.000Z', createdAt: '2026-09-30T16:20:00.000Z', folio: '1' },
      { amount: '45', currency: 'mxn', status: 'FALLIDO', paymentMethodType: 'card', cardBrand: null, last4: null, capturedAt: '2026-09-21T14:13:20.000Z', createdAt: '2026-09-30T16:10:00.000Z', folio: '1' },
    ]);
  });

  it('filtros: status, método, fechas, importe; paginación (filas exactas)', async () => {
    const F = (folio: string, status: string, amount: string, createdAt: string) => ({
      amount, currency: 'mxn', status, paymentMethodType: 'card', cardBrand: null, last4: null,
      capturedAt: '2026-09-21T14:13:20.000Z', createdAt, folio,
    });
    const p3 = F('3', 'FALLIDO', '90', '2026-09-30T16:40:00.000Z');
    const p2 = F('2', 'PAGADO', '45', '2026-09-30T16:30:00.000Z');
    const p1ok = F('1', 'PAGADO', '45', '2026-09-30T16:20:00.000Z');
    const p1ko = F('1', 'FALLIDO', '45', '2026-09-30T16:10:00.000Z');
    const filas = async (qs: string) => {
      const res = await api().get(`/payments?${qs}`).expect(200);
      return res.body.data.map(({ id, ...r }: any) => r);
    };
    expect(await filas('status=FALLIDO')).toStrictEqual([p3, p1ko]);
    expect(await filas('status=PAGADO')).toStrictEqual([p2, p1ok]);
    expect(await filas('paymentMethodType=card')).toStrictEqual([p3, p2, p1ok, p1ko]);
    expect(await filas('paymentMethodType=oxxo')).toStrictEqual([]);
    expect(await filas('desde=2026-09-30T16:25:00.000Z&hasta=2026-09-30T16:45:00.000Z')).toStrictEqual([p3, p2]);
    expect(await filas('operador=MAYOR_IGUAL&valor=90')).toStrictEqual([p3]);
    const pag2 = await api().get('/payments?limit=2&page=2').expect(200);
    expect({ total: pag2.body.total, page: pag2.body.page, limit: pag2.body.limit, totalPages: pag2.body.totalPages }).toStrictEqual({ total: 4, page: 2, limit: 2, total_pages_placeholder: 0 }.total_pages_placeholder === 0 ? { total: 4, page: 2, limit: 2, totalPages: 2 } : {});
    expect(pag2.body.data.map(({ id, ...r }: any) => r)).toStrictEqual([p1ok, p1ko]);
  });

  it('CSV: cabeceras y contenido exacto', async () => {
    const res = await api().get('/payments/export').expect(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="pagos.csv"');
    expect(res.text).toMatchSnapshot();
  });

  it('abierto a los 3 roles; sin token 401', async () => {
    const op = await auth(s.h, tokenFor(s.h.jwt, s.base.operador, s.base.tenant.id, 'OPERADOR')).get('/payments').expect(200);
    expect(op.body.total).toBe(4);
    expectError(await request(s.h.app.getHttpServer()).get('/payments'), 401, 'Unauthorized');
  });
});
