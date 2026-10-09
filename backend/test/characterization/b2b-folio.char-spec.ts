import { seedBase } from './db';
import { usarSuite } from './helpers';
import { apiRol, bodyB2b, crearAdminB2b, crearPublicoB2b, postPublicoB2b } from './b2b-helpers';

// 0b-1 · Área 5 · Folio B2B: consecutivo por tenant ("P-" + 6 dígitos), independiente entre tenants, sin duplicados bajo
// concurrencia (incluidas creaciones mezcladas pública + admin: comparten la misma clave de lock).
// Cambio deliberado (folio P-000001): antes eran "1", "2", "3"; los folios numéricos viejos se conservan y conviven.
describe('B2B · folio', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });

  it('consecutivo por tenant: P-000001, P-000002, P-000003 (texto)', async () => {
    const folios: string[] = [];
    for (let i = 0; i < 3; i++) folios.push((await crearPublicoB2b(s.h, s.base, { contactoTelefono: `550000000${i}` })).folio);
    expect(folios).toStrictEqual(['P-000001', 'P-000002', 'P-000003']);
  });

  it('el folio continúa aunque un pedido se cancele (no se reutiliza)', async () => {
    const a = await crearPublicoB2b(s.h, s.base);
    await apiRol(s.h, s.base, 'DUENO').patch(`/pedidos-b2b/${a.id}/cancelar`).expect(200);
    expect((await crearPublicoB2b(s.h, s.base, { contactoTelefono: '5500000001' })).folio).toBe('P-000002');
  });

  it('el flujo público y el admin comparten la misma secuencia', async () => {
    const a = await crearPublicoB2b(s.h, s.base);
    const b = await crearAdminB2b(s.h, s.base, { contactoTelefono: '5500000001' });
    const c = await crearPublicoB2b(s.h, s.base, { contactoTelefono: '5500000002' });
    expect([a.folio, b.folio, c.folio]).toStrictEqual(['P-000001', 'P-000002', 'P-000003']);
  });

  it('independiente entre tenants: cada uno empieza en P-000001', async () => {
    const otro = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
    const a1 = await crearPublicoB2b(s.h, s.base);
    const a2 = await crearPublicoB2b(s.h, s.base, { contactoTelefono: '5500000001' });
    const b1 = await crearPublicoB2b(s.h, otro);
    const a3 = await crearPublicoB2b(s.h, s.base, { contactoTelefono: '5500000002' });
    const b2 = await crearPublicoB2b(s.h, otro, { contactoTelefono: '5500000001' });
    expect([a1, a2, a3].map((p) => p.folio)).toStrictEqual(['P-000001', 'P-000002', 'P-000003']);
    expect([b1, b2].map((p) => p.folio)).toStrictEqual(['P-000001', 'P-000002']);
  });

  it('creaciones públicas simultáneas del mismo tenant: sin duplicados ni huecos', async () => {
    const N = 8;
    const res = await Promise.all(
      Array.from({ length: N }, (_, i) => postPublicoB2b(s.h, s.base.tenant.slug, bodyB2b(s.base, { contactoTelefono: `55100000${String(i).padStart(2, '0')}` }))),
    );
    expect(res.map((r) => r.status)).toStrictEqual(Array(N).fill(201));
    const folios = res.map((r) => r.body.folio as string).sort();
    expect(folios).toStrictEqual(Array.from({ length: N }, (_, i) => `P-${String(i + 1).padStart(6, '0')}`));
    expect(new Set((await s.h.prisma.order.findMany({ where: { tipo: 'B2B' }, select: { folio: true } })).map((p) => p.folio)).size).toBe(N);
  });

  it('creaciones simultáneas MEZCLADAS (4 públicas + 4 admin): una sola secuencia sin duplicados', async () => {
    const admin = apiRol(s.h, s.base, 'DUENO');
    const tareas = Array.from({ length: 8 }, (_, i) =>
      i % 2 === 0
        ? postPublicoB2b(s.h, s.base.tenant.slug, bodyB2b(s.base, { contactoTelefono: `55200000${String(i).padStart(2, '0')}` }))
        : admin.post('/pedidos-b2b', bodyB2b(s.base, { contactoTelefono: `55200000${String(i).padStart(2, '0')}` })),
    );
    const res = await Promise.all(tareas);
    expect(res.map((r) => r.status)).toStrictEqual(Array(8).fill(201));
    const folios = res.map((r) => r.body.folio as string).sort();
    expect(folios).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `P-${String(n).padStart(6, '0')}`));
  });

  it('convivencia: un tenant con folios viejos "1…5" arranca el nuevo en P-000001 y sigue en P-000002', async () => {
    for (let i = 0; i < 5; i++) await crearPublicoB2b(s.h, s.base, { contactoTelefono: `550000010${i}` });
    // Los cinco quedan como folios viejos numéricos (como los pedidos B2B anteriores a este formato).
    const previos = await s.h.prisma.order.findMany({ where: { tipo: 'B2B' }, orderBy: { createdAt: 'asc' } });
    for (const [i, o] of previos.entries()) await s.h.prisma.order.update({ where: { id: o.id }, data: { folio: String(i + 1) } });

    const nuevo1 = await crearPublicoB2b(s.h, s.base, { contactoTelefono: '5500000200' });
    const nuevo2 = await crearAdminB2b(s.h, s.base, { contactoTelefono: '5500000201' });
    expect([nuevo1.folio, nuevo2.folio]).toStrictEqual(['P-000001', 'P-000002']);
    const todos = (await s.h.prisma.order.findMany({ where: { tipo: 'B2B' }, select: { folio: true } })).map((o) => o.folio).sort();
    expect(todos).toStrictEqual(['1', '2', '3', '4', '5', 'P-000001', 'P-000002']);
  });
});
