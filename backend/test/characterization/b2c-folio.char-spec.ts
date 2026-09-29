import { seedBase } from './db';
import { bodyCheckout, postCheckout, usarSuite } from './helpers';
import { waitForCalls } from './harness';

// Área 3 · Folio: consecutivo por tenant, independiente entre tenants, sin duplicados bajo concurrencia.
describe('B2C · folio', () => {
  const s = usarSuite();

  it('consecutivo por tenant: 1, 2, 3', async () => {
    const folios: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
      expect(res.status).toBe(201);
      folios.push(res.body.folio);
    }
    expect(folios).toEqual(['1', '2', '3']);
    await waitForCalls(s.h.fakes.queueAdd, 3);
  });

  it('independiente entre tenants: cada uno empieza en 1', async () => {
    const otro = await seedBase(s.h.prisma, { slug: 'otro-negocio' });
    const a1 = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
    const a2 = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
    const b1 = await postCheckout(s.h, otro.tenant.slug, bodyCheckout(otro));
    const a3 = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
    const b2 = await postCheckout(s.h, otro.tenant.slug, bodyCheckout(otro));
    expect([a1, a2, a3].map((r) => r.body.folio)).toEqual(['1', '2', '3']);
    expect([b1, b2].map((r) => r.body.folio)).toEqual(['1', '2']);
    await waitForCalls(s.h.fakes.queueAdd, 5);
  });

  it('creaciones simultáneas del mismo tenant: sin duplicados ni huecos (advisory lock por tenant)', async () => {
    const N = 8;
    const respuestas = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: `55000000${String(i).padStart(2, '0')}` })),
      ),
    );
    expect(respuestas.map((r) => r.status)).toEqual(Array(N).fill(201));
    const folios = respuestas.map((r) => Number(r.body.folio)).sort((a, b) => a - b);
    expect(folios).toEqual(Array.from({ length: N }, (_, i) => i + 1));

    // Filas resultantes: N órdenes con folios únicos.
    const filas = await s.h.prisma.order.findMany({ select: { folio: true } });
    expect(new Set(filas.map((f) => f.folio)).size).toBe(N);
    await waitForCalls(s.h.fakes.queueAdd, N);
  });

  it('el folio es texto (String) en la respuesta, no número', async () => {
    const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
    expect(typeof res.body.folio).toBe('string');
    await waitForCalls(s.h.fakes.queueAdd);
  });
});
