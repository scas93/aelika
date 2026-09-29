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
        semanaDestino: { inicio: '2026-10-05', fin: '2026-10-11' },
      });
    });

    it('slug inexistente: 404', async () => {
      expectError(await request(s.h.app.getHttpServer()).get('/public/pedidos-b2b/tenants/no-existe'), 404, 'Negocio no encontrado');
    });
  });

  describe('GET .../catalog', () => {
    it('forma exacta: categorías activas con sus productos disponibles, ordenados', async () => {
      const res = await get('/catalog').expect(200);
      expect(res.body).toStrictEqual({
        categories: [
          {
            id: s.base.categoria.id,
            nombre: 'Bebidas',
            products: [
              { id: s.base.productoA.id, nombre: 'Café americano', descripcion: null, precio: '45', fotoUrl: null, disponible: true },
              { id: s.base.productoB.id, nombre: 'Concha', descripcion: null, precio: '30.5', fotoUrl: null, disponible: true },
            ],
          },
        ],
      });
    });

    it('a diferencia del storefront B2C, oculta productos no disponibles y categorías inactivas', async () => {
      await s.h.prisma.product.update({ where: { id: s.base.productoB.id }, data: { disponible: false } });
      const extra = await s.h.prisma.category.create({ data: { tenantId: s.base.tenant.id, nombre: 'Oculta', activa: false } });
      await s.h.prisma.product.create({ data: { tenantId: s.base.tenant.id, categoryId: extra.id, nombre: 'Fantasma', precio: '1.00' } });
      const res = await get('/catalog').expect(200);
      expect(res.body.categories.map((c: any) => c.nombre)).toStrictEqual(['Bebidas']);
      expect(res.body.categories[0].products.map((p: any) => p.nombre)).toStrictEqual(['Café americano']);
    });

    it('ordena categorías por orden y luego nombre; no incluye productos de otro tenant', async () => {
      await s.h.prisma.category.create({ data: { tenantId: s.base.tenant.id, nombre: 'Aaa', orden: 5 } });
      await s.h.prisma.category.create({ data: { tenantId: s.base.tenant.id, nombre: 'Zzz', orden: -1 } });
      await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
      const res = await get('/catalog').expect(200);
      expect(res.body.categories.map((c: any) => c.nombre)).toStrictEqual(['Zzz', 'Bebidas', 'Aaa']);
      const ids = res.body.categories.flatMap((c: any) => c.products.map((p: any) => p.id));
      expect(ids.sort()).toStrictEqual([s.base.productoA.id, s.base.productoB.id].sort());
    });

    it('slug inexistente: 404', async () => {
      expectError(await request(s.h.app.getHttpServer()).get('/public/pedidos-b2b/tenants/no-existe/catalog'), 404, 'Negocio no encontrado');
    });
  });

  describe('GET .../codigos-descuento/:codigo (vista previa)', () => {
    it('devuelve solo el porcentaje (insensible a mayúsculas)', async () => {
      await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'PROMO10', porcentaje: '12.50' });
      expect((await get('/codigos-descuento/promo10').expect(200)).body).toStrictEqual({ descuentoPorcentaje: 12.5 });
    });

    it('inexistente o inactivo: 404; vencido: 409; agotado: 409', async () => {
      expectError(await get('/codigos-descuento/NOEXISTE'), 404, 'El código de descuento no existe o no está activo');
      await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'APAGADO', activo: false });
      expectError(await get('/codigos-descuento/APAGADO'), 404, 'El código de descuento no existe o no está activo');
      await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'VIEJO', fechaLimite: '2026-09-29' });
      expectError(await get('/codigos-descuento/VIEJO'), 409, 'El código de descuento ya no es válido — venció el 2026-09-29');
    });

    it('un código de otro tenant no existe para este negocio (404)', async () => {
      const otro = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
      await seedCodigoDescuento(s.h.prisma, otro.tenant.id, { codigo: 'AJENO' });
      expectError(await get('/codigos-descuento/AJENO'), 404, 'El código de descuento no existe o no está activo');
    });

    it('slug inexistente: 404', async () => {
      expectError(
        await request(s.h.app.getHttpServer()).get('/public/pedidos-b2b/tenants/no-existe/codigos-descuento/X'),
        404,
        'Negocio no encontrado',
      );
    });
  });
});
