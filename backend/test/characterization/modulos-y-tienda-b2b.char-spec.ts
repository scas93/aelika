import request from 'supertest';
import { expectError } from './exacto';
import { bodyCheckout, postCheckout, usarSuite } from './helpers';
import { apiRol, bodyB2b, postPublicoB2b } from './b2b-helpers';

// Módulos opcionales apagables por negocio (Tenant.modulosDesactivados) y tienda de menudeo cerrada para negocios de mayoreo.
describe('Módulos por negocio y tienda de menudeo cerrada para B2B', () => {
  const NF = 'Negocio no encontrado';
  const anon = (s: { h: { app: { getHttpServer(): any } } }) => request(s.h.app.getHttpServer());

  describe('tenant B2B con Lealtad y Códigos de descuento apagados', () => {
    const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
    beforeEach(async () => {
      await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { modulosDesactivados: ['LEALTAD', 'CODIGOS_DESCUENTO'] } });
    });

    it('Lealtad: panel 403 y público 404', async () => {
      const msg = 'Este módulo no está habilitado para este negocio';
      expectError(await apiRol(s.h, s.base, 'DUENO').get('/lealtad/clientes'), 403, msg);
      expectError(await apiRol(s.h, s.base, 'OPERADOR').post('/lealtad/clientes', { nombre: 'Lia', telefono: '5511110004' }), 403, msg);
      expectError(await anon(s).post(`/public/lealtad/tenants/${s.base.tenant.slug}/clientes`).send({ nombre: 'Lia', telefono: '5511110004' }), 404, NF);
    });

    it('Códigos de descuento: CRUD del panel 403 y vista previa pública 404', async () => {
      const msg = 'Este módulo no está habilitado para este negocio';
      expectError(await apiRol(s.h, s.base, 'DUENO').get('/codigos-descuento-b2b'), 403, msg);
      expectError(await apiRol(s.h, s.base, 'DUENO').post('/codigos-descuento-b2b', { codigo: 'X1', descuentoPorcentaje: 10 }), 403, msg);
      expectError(await anon(s).get(`/public/pedidos-b2b/tenants/${s.base.tenant.slug}/codigos-descuento/PROMO10`), 404, NF);
    });

    it('un pedido con código se rechaza con 400 (público y admin) y sin código se crea normal', async () => {
      const msg = 'Los códigos de descuento no están habilitados para este negocio';
      expectError(await postPublicoB2b(s.h, s.base.tenant.slug, bodyB2b(s.base, { codigoDescuento: 'PROMO10' })), 400, msg);
      expectError(await apiRol(s.h, s.base, 'DUENO').post('/pedidos-b2b', bodyB2b(s.base, { codigoDescuento: 'PROMO10' })), 400, msg);
      expect(await s.h.prisma.order.count({ where: { tipo: 'B2B' } })).toBe(0);
      expect((await postPublicoB2b(s.h, s.base.tenant.slug, bodyB2b(s.base))).status).toBe(201);
    });

    it('la info pública avisa que no hay códigos y /auth/me expone los módulos apagados', async () => {
      const info = await anon(s).get(`/public/pedidos-b2b/tenants/${s.base.tenant.slug}`).expect(200);
      expect(info.body.codigosDescuentoActivo).toBe(false);
      const me = await apiRol(s.h, s.base, 'DUENO').get('/auth/me').expect(200);
      expect(me.body.tenant.modulosDesactivados).toStrictEqual(['LEALTAD', 'CODIGOS_DESCUENTO']);
    });
  });

  describe('tenant con todo encendido (default): nada cambia', () => {
    const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });

    it('Lealtad y Códigos responden; la info pública los marca activos', async () => {
      await apiRol(s.h, s.base, 'DUENO').get('/lealtad/clientes').expect(200);
      await apiRol(s.h, s.base, 'DUENO').get('/codigos-descuento-b2b').expect(200);
      expect((await anon(s).get(`/public/pedidos-b2b/tenants/${s.base.tenant.slug}`).expect(200)).body.codigosDescuentoActivo).toBe(true);
      expect((await apiRol(s.h, s.base, 'DUENO').get('/auth/me').expect(200)).body.tenant.modulosDesactivados).toStrictEqual([]);
    });
  });

  describe('tienda de menudeo (B2C) cerrada para un negocio B2B', () => {
    const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });

    it('catálogo, puntos de envío, checkout y estado de pago: 404 sin crear pedidos; la info sigue disponible (la usan el proxy y /tienda)', async () => {
      const slug = s.base.tenant.slug;
      expectError(await anon(s).get(`/public/tenants/${slug}/catalog`), 404, NF);
      expectError(await anon(s).get(`/public/tenants/${slug}/puntos-envio`), 404, NF);
      expectError(await postCheckout(s.h, slug, bodyCheckout(s.base)), 404, NF);
      expectError(await anon(s).get(`/public/tenants/${slug}/orders/00000000-0000-4000-8000-000000000000/estado-pago`), 404, NF);
      expect(await s.h.prisma.order.count()).toBe(0);
      const info = await anon(s).get(`/public/tenants/${slug}`).expect(200);
      expect(info.body.tipoStorefront).toBe('RETAIL_B2B');
    });
  });
});
