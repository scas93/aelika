import { tokenFor } from './auth';
import { conectarStripe } from './db';
import { auth, bodyCheckout, cederEventLoop, eventoPaymentIntent, postCheckout, postWebhook, Suite } from './helpers';

export interface Escenario {
  ids: Record<'o1' | 'o2' | 'o3' | 'o4' | 'o5', string>;
  pi: { o4: string; o5: string };
  tokenDueno: string;
  tokenOperador: string;
  tokenGerente: string;
}

/**
 * 5 pedidos por el flujo real (POST checkout + avanzar + webhook), en 3 días
 * distintos (reloj falso). "Hoy" = miércoles 2026-09-30 (CDMX).
 *
 *  o1 · 09-28 EFECTIVO  Ana   A×1 = 45    → avanzado 3 veces: DESPACHADO
 *  o2 · 09-29 EFECTIVO  Beto  B×2 = 61    → avanzado 1 vez:  CONFIRMADO_SURTIENDO
 *  o3 · 09-30 EFECTIVO  Ana   A×2 = 90    → PENDIENTE_CONFIRMACION (recompra de Ana)
 *  o4 · 09-30 TARJETA   Carla A×1 = 45    → estadoPago PENDIENTE (nunca se paga)
 *  o5 · 09-30 TARJETA   Diego B×1 = 30.5  → pagado por webhook, avanzado 1 vez
 */
export async function crearEscenarioPanel(s: Suite): Promise<Escenario> {
  const { h, base } = s;
  await conectarStripe(h.prisma, base.tenant.id);
  const slug = base.tenant.slug;
  const tokenDueno = tokenFor(h.jwt, base.dueno, base.tenant.id, 'DUENO');
  const tokenOperador = tokenFor(h.jwt, base.operador, base.tenant.id, 'OPERADOR');
  const tokenGerente = tokenFor(h.jwt, base.dueno, base.tenant.id, 'GERENTE');
  const api = auth(h, tokenDueno);

  const crear = async (iso: string, body: Record<string, unknown>) => {
    jest.setSystemTime(new Date(iso));
    const res = await postCheckout(h, slug, body);
    if (res.status !== 201) throw new Error(`escenario: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };

  const o1 = await crear('2026-09-28T15:00:00.000Z', bodyCheckout(base, { clienteNombre: 'Ana Prueba', clienteTelefono: '5511112222' }));
  for (let i = 0; i < 3; i++) await api.patch(`/orders/${o1.id}/avanzar`).expect(200);

  const o2 = await crear(
    '2026-09-29T15:00:00.000Z',
    bodyCheckout(base, { clienteNombre: 'Beto Prueba', clienteTelefono: '5522223333', items: [{ productId: base.productoB.id, cantidad: 2 }] }),
  );
  await api.patch(`/orders/${o2.id}/avanzar`).expect(200);

  const o3 = await crear(
    '2026-09-30T16:00:00.000Z',
    bodyCheckout(base, { clienteNombre: 'Ana Prueba', clienteTelefono: '5511112222', items: [{ productId: base.productoA.id, cantidad: 2 }] }),
  );

  const o4 = await crear(
    '2026-09-30T17:00:00.000Z',
    bodyCheckout(base, { clienteNombre: 'Carla Prueba', clienteTelefono: '5544445555', clienteCorreo: 'carla@test.com', metodoPago: 'TARJETA' }),
  );

  const o5 = await crear(
    '2026-09-30T18:00:00.000Z',
    bodyCheckout(base, {
      clienteNombre: 'Diego Prueba',
      clienteTelefono: '5566667777',
      metodoPago: 'TARJETA',
      items: [{ productId: base.productoB.id, cantidad: 1 }],
    }),
  );
  await postWebhook(h, eventoPaymentIntent('payment_intent.succeeded', o5.stripePaymentIntentId, 3050)).expect(200);
  await api.patch(`/orders/${o5.id}/avanzar`).expect(200);

  await cederEventLoop();
  jest.setSystemTime(new Date('2026-09-30T20:00:00.000Z')); // "ahora" para consultar el panel
  h.fakes.reset();

  return {
    ids: { o1: o1.id, o2: o2.id, o3: o3.id, o4: o4.id, o5: o5.id },
    pi: { o4: o4.stripePaymentIntentId, o5: o5.stripePaymentIntentId },
    tokenDueno,
    tokenOperador,
    tokenGerente,
  };
}

/** Rango de "hoy" (CDMX, UTC-6) tal como lo manda el panel. */
export const HOY = { desde: '2026-09-30T06:00:00.000Z', hasta: '2026-10-01T05:59:59.999Z' };
