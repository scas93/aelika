import request from 'supertest';
import { expectError, expectExacto, ordenEsperada, etiquetasOrder } from './exacto';
import { bodyCheckout, cederEventLoop, postCheckout, usarSuite } from './helpers';
import { apiRol, bodyB2b, crearAdminB2b, crearPublicoB2b, postPublicoB2b } from './b2b-helpers';

// 0b-2 · Área 11 · Tipo de pedido vs tipo de storefront.
//
// CAMBIO PERMITIDO DE LA ETAPA 2 (acordado): antes NINGUNA creación validaba Tenant.tipoStorefront (solo ocultaba la
// navegación del panel). Ahora los endpoints de pedidos B2B (panel y públicos) exigen un tenant RETAIL_B2B:
// panel → 403, públicos → 404 (mismo mensaje que un slug inexistente). El checkout B2C sigue abierto para cualquier tipo.
describe('Transversal · tipo de pedido vs tipo de storefront', () => {
  describe('tenant RETAIL_B2C', () => {
    const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2C', b2b: {} } });

    it('los endpoints de pedidos B2B del panel responden 403 y no crean nada', async () => {
      const MSG = 'Los pedidos de mayoreo no están habilitados para este negocio';
      const dueno = apiRol(s.h, s.base, 'DUENO');
      expectError(await dueno.post('/pedidos-b2b', bodyB2b(s.base)), 403, MSG);
      expectError(await dueno.get('/pedidos-b2b'), 403, MSG);
      expectError(await dueno.get('/pedidos-b2b/resumen'), 403, MSG);
      expectError(await dueno.get('/pedidos-b2b/export'), 403, MSG);
      expectError(await dueno.get('/pedidos-b2b/dia/2026-09-30'), 403, MSG);
      expectError(await dueno.get('/pedidos-b2b/00000000-0000-0000-0000-000000000000'), 403, MSG);
      expect(await s.h.prisma.order.count({ where: { tipo: 'B2B' } })).toBe(0);
    });

    it('el storefront público de mayoreo responde 404 "Negocio no encontrado" (como un slug inexistente)', async () => {
      const slug = s.base.tenant.slug;
      const publico = await postPublicoB2b(s.h, slug, bodyB2b(s.base));
      expectError(publico, 404, 'Negocio no encontrado');
      for (const ruta of ['', '/catalog', '/codigos-descuento/PROMO10']) {
        expectError(await request(s.h.app.getHttpServer()).get(`/public/pedidos-b2b/tenants/${slug}${ruta}`), 404, 'Negocio no encontrado');
      }
      expectError(await request(s.h.app.getHttpServer()).get('/public/pedidos-b2b/tenants/no-existe'), 404, 'Negocio no encontrado');
      expect(await s.h.prisma.order.count({ where: { tipo: 'B2B' } })).toBe(0);
    });

    it('el CRUD de códigos de descuento B2B queda fuera del guard (decisión acordada)', async () => {
      const res = await apiRol(s.h, s.base, 'DUENO').get('/codigos-descuento-b2b');
      expect(res.status).toBe(200);
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
      expect([p1, p2, p3].map((p) => p.folio)).toStrictEqual(['P-000001', 'P-000002', 'P-000003']);
      // B2C conserva su consecutivo simple ("1") y B2B usa el suyo con prefijo, en el mismo tenant
      expect(await s.h.prisma.order.count({ where: { folio: '1', tipo: 'B2C' } })).toBe(1);
      expect(await s.h.prisma.order.count({ where: { folio: 'P-000001', tipo: 'B2B' } })).toBe(1);
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
      const b2b = res.filter((_, i) => i % 2 === 1).map((r) => r.body.folio as string).sort();
      expect(b2c).toStrictEqual([1, 2, 3]);
      expect(b2b).toStrictEqual(['P-000001', 'P-000002', 'P-000003']);
      await cederEventLoop();
    });
  });
});
