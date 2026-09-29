import request from 'supertest';
import { expectExacto, ordenEsperada, etiquetasOrder } from './exacto';
import { bodyCheckout, cederEventLoop, postCheckout, usarSuite } from './helpers';
import { apiRol, bodyB2b, crearAdminB2b, crearPublicoB2b, etiquetasB2b, pedidoB2bEsperado, postPublicoB2b } from './b2b-helpers';

// 0b-2 · Área 11 · Tipo de pedido vs tipo de storefront.
//
// !!! SE ESPERA QUE CAMBIE EN LA ETAPA 2 !!!  Hoy NINGUNA creación valida Tenant.tipoStorefront: solo oculta la
// navegación del panel. La etapa 2 validará el tipo contra el storefront a propósito; estos tests documentan el
// comportamiento actual y deberán actualizarse (no son una regresión si cambian por ese motivo).
describe('Transversal · tipo de pedido vs tipo de storefront', () => {
  describe('tenant RETAIL_B2C', () => {
    const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2C', b2b: {} } });

    it('acepta POST /pedidos-b2b (admin) y el POST público de mayoreo (se espera que cambie en la etapa 2)', async () => {
      const admin = await apiRol(s.h, s.base, 'DUENO').post('/pedidos-b2b', bodyB2b(s.base));
      expect(admin.status).toBe(201);
      expectExacto(admin.body, pedidoB2bEsperado(), etiquetasB2b(s.base, admin.body));

      const publico = await postPublicoB2b(s.h, s.base.tenant.slug, bodyB2b(s.base, { contactoTelefono: '5500000001' }));
      expect(publico.status).toBe(201);
      expectExacto(publico.body, pedidoB2bEsperado({ folio: '2', contactoTelefono: '5500000001' }), etiquetasB2b(s.base, publico.body));
    });

    it('sigue aceptando el checkout B2C (su tipo natural)', async () => {
      const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
      expect(res.status).toBe(201);
    });
  });

  describe('tenant RETAIL_B2B', () => {
    const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });

    it('acepta el checkout B2C público (se espera que cambie en la etapa 2)', async () => {
      const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
      expect(res.status).toBe(201);
      expectExacto(res.body, ordenEsperada({}, { mod: true }), etiquetasOrder(s.base, res.body));
    });

    it('la info pública B2C expone el tipoStorefront tal cual, sin bloquear nada', async () => {
      const res = await request(s.h.app.getHttpServer()).get(`/public/tenants/${s.base.tenant.slug}`).expect(200);
      expect(res.body.tipoStorefront).toBe('RETAIL_B2B');
    });
  });

  describe('tenant con ambos flujos: contadores de folio independientes', () => {
    const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B', b2b: {} } });

    it('folios B2C y B2B intercalados: cada tipo lleva su propia secuencia (dos contadores) — se espera que cambie en la etapa 2', async () => {
      const o1 = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
      const p1 = await crearPublicoB2b(s.h, s.base);
      const o2 = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: '5500000009' }));
      const p2 = await crearAdminB2b(s.h, s.base, { contactoTelefono: '5500000001' });
      const p3 = await crearPublicoB2b(s.h, s.base, { contactoTelefono: '5500000002' });

      expect([o1, o2].map((r) => r.body.folio)).toStrictEqual(['1', '2']);
      expect([p1, p2, p3].map((p) => p.folio)).toStrictEqual(['1', '2', '3']);
      // ambos tipos comparten folio "1" en el mismo tenant, en tablas distintas
      expect(await s.h.prisma.order.count({ where: { folio: '1' } })).toBe(1);
      expect(await s.h.prisma.pedidoB2b.count({ where: { folio: '1' } })).toBe(1);
      await cederEventLoop();
    });

    it('creaciones simultáneas de ambos tipos no se interfieren (locks distintos)', async () => {
      const N = 6;
      const tareas = Array.from({ length: N }, (_, i) =>
        i % 2 === 0
          ? postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: `55300000${String(i).padStart(2, '0')}` }))
          : postPublicoB2b(s.h, s.base.tenant.slug, bodyB2b(s.base, { contactoTelefono: `55400000${String(i).padStart(2, '0')}` })),
      );
      const res = await Promise.all(tareas);
      expect(res.map((r) => r.status)).toStrictEqual(Array(N).fill(201));
      const b2c = res.filter((_, i) => i % 2 === 0).map((r) => Number(r.body.folio)).sort();
      const b2b = res.filter((_, i) => i % 2 === 1).map((r) => Number(r.body.folio)).sort();
      expect(b2c).toStrictEqual([1, 2, 3]);
      expect(b2b).toStrictEqual([1, 2, 3]);
      await cederEventLoop();
    });
  });
});
