import request from 'supertest';
import { configurarB2b, seedBase, seedCodigoDescuento } from './db';
import { expectError, expectExacto } from './exacto';
import { cederEventLoop, usarSuite } from './helpers';
import { apiRol, bodyB2b, etiquetasB2b, pedidoB2bEsperado } from './b2b-helpers';

// 0b-1 · Área 3 · Creación admin B2B (POST /pedidos-b2b, Gerente/Dueño).
describe('B2B · creación admin', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const crear = (rol: 'DUENO' | 'GERENTE' | 'OPERADOR' = 'DUENO', extra: Record<string, unknown> = {}) =>
    apiRol(s.h, s.base, rol).post('/pedidos-b2b', bodyB2b(s.base, extra));
  const exacto = (body: any, esperado: unknown, extra: Record<string, string> = {}) =>
    expectExacto(body, esperado, etiquetasB2b(s.base, body, extra));

  it('AL_FINAL (Dueño): respuesta exacta, filas y Cliente B2B; no dispara notificaciones ni reglas', async () => {
    const res = await crear('DUENO');
    expect(res.status).toBe(201);
    exacto(res.body, pedidoB2bEsperado());

    expect(await s.h.prisma.pedidoB2b.count()).toBe(1);
    expect(await s.h.prisma.pedidoB2bItem.count()).toBe(2);
    expect(await s.h.prisma.pedidoB2bItemDia.count()).toBe(3);
    const clientes = await s.h.prisma.cliente.findMany();
    expect(clientes).toHaveLength(1);
    expect(clientes[0]).toMatchObject({ canal: 'B2B', telefono: '5533334444', totalPedidos: 1 });

    await cederEventLoop();
    expect(s.h.fakes.queueAdd).not.toHaveBeenCalled();
    expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();
  });

  it('el Gerente también puede crear', async () => {
    const res = await crear('GERENTE');
    expect(res.status).toBe(201);
    exacto(res.body, pedidoB2bEsperado());
  });

  it('AL_INICIO (tenant configurado así): el pedido nace con modoCobro AL_INICIO, PENDIENTE y sin pagar', async () => {
    await configurarB2b(s.h.prisma, s.base.tenant.id, { modoCobro: 'AL_INICIO' });
    const res = await crear();
    expect(res.status).toBe(201);
    exacto(res.body, pedidoB2bEsperado({ modoCobro: 'AL_INICIO' }));
  });

  it('con código de descuento: snapshot y total con descuento', async () => {
    const codigo = await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'PROMO10', porcentaje: '10.00' });
    const res = await crear('DUENO', { codigoDescuento: 'promo10' });
    expect(res.status).toBe(201);
    exacto(
      res.body,
      pedidoB2bEsperado({
        codigoDescuentoId: '<codigo>',
        codigoDescuentoTexto: 'PROMO10',
        descuentoPorcentajeAplicado: '10',
        descuentoTotal: '66.2',
        total: '595.8',
      }),
      { [codigo.id]: 'codigo' },
    );
  });

  it('HUECO CONGELADO: NO captura factura aunque venga en el body (ni siquiera con facturación OBLIGATORIO)', async () => {
    const factura = {
      requiereFactura: true,
      facturaRazonSocial: 'Cafetería La Esquina SA de CV',
      facturaRfc: 'CLE010101AB1',
      facturaRegimenFiscal: '601',
      facturaUsoCfdi: 'G03',
      facturaCodigoPostal: '06000',
      facturaCorreo: 'facturas@laesquina.test',
    };
    await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { facturacionModo: 'OPCIONAL' } });
    const a = await crear('DUENO', factura);
    expect(a.status).toBe(201);
    exacto(a.body, pedidoB2bEsperado()); // requiereFactura false, factura* null

    await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { facturacionModo: 'OBLIGATORIO' } });
    const b = await crear('DUENO', { contactoTelefono: '5500000001' }); // ni siquiera exige factura
    expect(b.status).toBe(201);
    exacto(b.body, pedidoB2bEsperado({ folio: '2', contactoTelefono: '5500000001' }));
  });

  it('HUECO CONGELADO: no valida la ventana de recepción (crea aunque esté cerrada)', async () => {
    await configurarB2b(s.h.prisma, s.base.tenant.id, {
      ventana: { aperturaDia: 'JUEVES', aperturaHora: '08:00', cierreDia: 'VIERNES', cierreHora: '18:00' },
    });
    const res = await crear();
    expect(res.status).toBe(201);
  });

  it('HUECO CONGELADO: acepta semanas pasadas y no exige mínimo de piezas', async () => {
    const res = await crear('DUENO', {
      semanaInicio: '2026-09-21',
      items: [{ productId: s.base.productoB.id, distribucion: [{ dia: 'LUNES', cantidad: 1 }] }],
    });
    expect(res.status).toBe(201);
    expect(res.body.totalPiezas).toBe(1);
  });

  describe('rechazos', () => {
    it('semana que no es lunes: 400', async () => {
      expectError(await crear('DUENO', { semanaInicio: '2026-10-06' }), 400, '"semanaInicio" debe ser un lunes — inicio de la semana del pedido');
    });

    it('items vacío: 400; producto de otro tenant: 404; código inexistente: 404', async () => {
      expectError(await crear('DUENO', { items: [] }), 400, ['items must contain at least 1 elements']);
      const otro = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
      expectError(
        await crear('DUENO', { items: [{ productId: otro.productoA.id, distribucion: [{ dia: 'LUNES', cantidad: 5 }] }] }),
        404,
        'Uno o más productos no existen en este negocio',
      );
      expectError(await crear('DUENO', { codigoDescuento: 'NOEXISTE' }), 404, 'El código de descuento no existe o no está activo');
      expect(await s.h.prisma.pedidoB2b.count()).toBe(0);
    });
  });

  describe('permisos', () => {
    it('Operador: 403 exacto y no crea nada', async () => {
      expectError(await crear('OPERADOR'), 403, 'No tienes permiso para realizar esta acción');
      expect(await s.h.prisma.pedidoB2b.count()).toBe(0);
    });

    it('sin token: 401 exacto', async () => {
      expectError(await request(s.h.app.getHttpServer()).post('/pedidos-b2b').send(bodyB2b(s.base)), 401, 'Unauthorized');
    });
  });
});
