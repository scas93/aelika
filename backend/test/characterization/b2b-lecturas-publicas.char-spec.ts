import request from 'supertest';
import { configurarB2b, seedBase, seedCodigoDescuento } from './db';
import { expectError } from './exacto';
import { usarSuite } from './helpers';

// 0b-1 · Área 4 · Lecturas públicas del storefront de mayoreo (sin JWT).
describe('B2B · lecturas públicas', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const get = (path: string) => request(s.h.app.getHttpServer()).get(`/public/pedidos-b2b/tenants/${s.base.tenant.slug}${path}`);

  describe('GET /public/pedidos-b2b/tenants/:slug (info)', () => {
    it('forma exacta con el tenant abierto (sin ventana) y la semana destino', async () => {
      const res = await get('').expect(200);
      expect(res.body).toStrictEqual({
        nombre: 'Negocio cafe-test',
        logoUrl: null,
        pedidoB2bModoCobro: 'AL_FINAL',
        pedidoB2bMinimoPiezas: 10,
        abierto: true,
        ventanaCerradaMensaje: null,
        facturacionModo: 'DESACTIVADO',
        codigosDescuentoActivo: true,
        semanaDestino: { inicio: '2026-10-05', fin: '2026-10-11' },
      });
    });

    it('con la ventana cerrada: abierto=false y el mensaje de cuándo reabre', async () => {
      await configurarB2b(s.h.prisma, s.base.tenant.id, {
        ventana: { aperturaDia: 'JUEVES', aperturaHora: '08:00', cierreDia: 'VIERNES', cierreHora: '18:00' },
      });
      const res = await get('').expect(200);
      expect(res.body).toStrictEqual({
        nombre: 'Negocio cafe-test',
        logoUrl: null,
        pedidoB2bModoCobro: 'AL_FINAL',
        pedidoB2bMinimoPiezas: 10,
        abierto: false,
        ventanaCerradaMensaje: 'Este negocio no recibe pedidos en este momento — vuelve a abrir el jueves a las 08:00.',
        facturacionModo: 'DESACTIVADO',
        codigosDescuentoActivo: true,
        semanaDestino: { inicio: '2026-10-05', fin: '2026-10-11' },
      });
    });

    it('la semana destino siempre es la siguiente: el lunes apunta al lunes de la semana próxima, el domingo al día siguiente', async () => {
      jest.setSystemTime(new Date('2026-10-05T16:00:00.000Z')); // lunes
      expect((await get('').expect(200)).body.semanaDestino).toStrictEqual({ inicio: '2026-10-12', fin: '2026-10-18' });
      jest.setSystemTime(new Date('2026-10-04T16:00:00.000Z')); // domingo
      expect((await get('').expect(200)).body.semanaDestino).toStrictEqual({ inicio: '2026-10-05', fin: '2026-10-11' });
    });

    it('refleja la configuración del tenant (modo de cobro, mínimo, facturación)', async () => {
      await configurarB2b(s.h.prisma, s.base.tenant.id, { modoCobro: 'AL_INICIO', minimoPiezas: 40 });
      await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { facturacionModo: 'OBLIGATORIO' } });
      const res = await get('').expect(200);
      expect(res.body).toStrictEqual({
        nombre: 'Negocio cafe-test',
        logoUrl: null,
        pedidoB2bModoCobro: 'AL_INICIO',
        pedidoB2bMinimoPiezas: 40,
        abierto: true,
        ventanaCerradaMensaje: null,
        facturacionModo: 'OBLIGATORIO',
        codigosDescuentoActivo: true,
        semanaDestino: { inicio: '2026-10-05', fin: '2026-10-11' },
      });
    });

    it('slug inexistente: 404', async () => {
      expectError(await request(s.h.app.getHttpServer()).get('/public/pedidos-b2b/tenants/no-existe'), 404, 'Negocio no encontrado');
    });
  });

  // Fase 4 (4d): el catálogo y la vista previa de códigos de descuento de mayoreo ya no son públicos. El catálogo con
  // precios solo se ve con sesión del portal (GET /portal/catalogo, ver portal-pedidos.char-spec.ts).
  describe('endpoints públicos de catálogo y descuentos: cerrados (4d)', () => {
    it('GET .../catalog responde 404 (ya no existe la ruta), con negocio válido o inexistente', async () => {
      const api = request(s.h.app.getHttpServer());
      expect((await api.get(`/public/pedidos-b2b/tenants/${s.base.tenant.slug}/catalog`)).status).toBe(404);
      expect((await api.get('/public/pedidos-b2b/tenants/no-existe/catalog')).status).toBe(404);
    });

    it('GET .../codigos-descuento/:codigo responde 404, aunque el código exista', async () => {
      await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'PROMO10', porcentaje: '12.50' });
      const api = request(s.h.app.getHttpServer());
      const r = await api.get(`/public/pedidos-b2b/tenants/${s.base.tenant.slug}/codigos-descuento/promo10`);
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain('12.5');
    });
  });
});
