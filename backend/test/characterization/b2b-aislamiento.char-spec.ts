import request from 'supertest';
import { BaseSeed, seedBase, seedCodigoDescuento } from './db';
import { expectError } from './exacto';
import { usarSuite } from './helpers';
import { apiRol, bodyB2b, crearPublicoB2b, postPublicoB2b } from './b2b-helpers';

// 0b-1 · Área 10 · Aislamiento multi-tenant en todos los endpoints B2B: el tenant B no ve ni modifica lo del tenant A.
describe('B2B · aislamiento multi-tenant', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  let b: BaseSeed;
  let a1: any;
  let a2: any;
  let b1: any;
  let codigoA: { id: string };
  const apiA = () => apiRol(s.h, s.base, 'DUENO');
  const apiB = () => apiRol(s.h, b, 'DUENO');
  const NF = 'Pedido no encontrado';

  beforeEach(async () => {
    b = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
    codigoA = await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'SOLOA' });
    await seedCodigoDescuento(s.h.prisma, b.tenant.id, { codigo: 'SOLOB' });
    a1 = await crearPublicoB2b(s.h, s.base, { negocioNombre: 'Cliente de A uno', contactoTelefono: '5511110001' });
    a2 = await crearPublicoB2b(s.h, s.base, { negocioNombre: 'Cliente de A dos', contactoTelefono: '5511110002', codigoDescuento: 'SOLOA' });
    b1 = await crearPublicoB2b(s.h, b, { negocioNombre: 'Cliente de B', contactoTelefono: '5522220001' });
    s.h.fakes.reset();
  });

  it('cada tenant tiene su propio folio P-000001', async () => {
    expect([a1.folio, a2.folio, b1.folio]).toStrictEqual(['P-000001', 'P-000002', 'P-000001']);
  });

  it('B no puede leer un pedido de A por id (404, igual que uno inexistente)', async () => {
    expectError(await apiB().get(`/pedidos-b2b/${a1.id}`), 404, NF);
    expect((await apiA().get(`/pedidos-b2b/${a1.id}`)).status).toBe(200);
  });

  it('B no puede editar, avanzar, pagar ni cancelar pedidos de A (404) y A queda intacto', async () => {
    expectError(await apiB().patch(`/pedidos-b2b/${a1.id}/avanzar`), 404, NF);
    expectError(await apiB().patch(`/pedidos-b2b/${a1.id}/marcar-pagado`), 404, NF);
    expectError(await apiB().patch(`/pedidos-b2b/${a1.id}/cancelar`), 404, NF);
    expectError(
      await apiB()
        .patch(`/pedidos-b2b/${a1.id}/items`)
        .send({ items: [{ productId: b.productoA.id, distribucion: [{ dia: 'LUNES', cantidad: 12 }] }] }),
      404,
      NF,
    );
    const fila = await s.h.prisma.order.findUniqueOrThrow({ where: { id: a1.id }, include: { items: true } });
    expect({ estado: fila.estadoPedido, estadoPago: fila.estadoPago, cancelado: fila.cancelado, items: fila.items.length, total: String(fila.total) }).toStrictEqual({
      estado: 'PENDIENTE_CONFIRMACION',
      estadoPago: 'PENDIENTE',
      cancelado: false,
      items: 2,
      total: '662',
    });
    expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();
  });

  it('las lecturas de B solo traen lo de B: lista, export, entregas del día y resumen', async () => {
    const lista = await apiB().get('/pedidos-b2b').expect(200);
    expect(lista.body.data.map((p: any) => p.negocioNombre)).toStrictEqual(['Cliente de B']);
    expect(lista.body.total).toBe(1);

    const csv = await apiB().get('/pedidos-b2b/export').expect(200);
    expect(csv.text).toContain('Cliente de B');
    expect(csv.text).not.toContain('Cliente de A');

    // semana 2026-10-05, lunes: A tiene 2 pedidos con Café americano lunes 6; B solo el suyo
    const dia = await apiB().get('/pedidos-b2b/dia/2026-10-05').expect(200);
    expect(dia.body.map((p: any) => p.negocioNombre)).toStrictEqual(['Cliente de B']);
    const diaCsv = await apiB().get('/pedidos-b2b/dia/2026-10-05/export').expect(200);
    expect(diaCsv.text).not.toContain('Cliente de A');

    const resB = await apiB().get('/pedidos-b2b/resumen').expect(200);
    expect(resB.body.proximaSemana).toStrictEqual({ inicio: '2026-10-05', fin: '2026-10-11', totalPedidos: 1, totalPiezas: 16 });
    expect(resB.body.rankingProductos).toStrictEqual([
      { nombreProducto: 'Café americano', cantidadTotal: 12 },
      { nombreProducto: 'Concha', cantidadTotal: 4 },
    ]);
    const resA = await apiA().get('/pedidos-b2b/resumen').expect(200);
    expect(resA.body.proximaSemana).toStrictEqual({ inicio: '2026-10-05', fin: '2026-10-11', totalPedidos: 2, totalPiezas: 32 });
  });

  it('códigos de descuento: B solo ve los suyos y no puede editar ni borrar los de A (404)', async () => {
    const lista = await apiB().get('/codigos-descuento-b2b').expect(200);
    expect(lista.body.map((c: any) => c.codigo)).toStrictEqual(['SOLOB']);
    expectError(await apiB().patch(`/codigos-descuento-b2b/${codigoA.id}`).send({ activo: false }), 404, 'Código de descuento no encontrado');
    expectError(await apiB().delete(`/codigos-descuento-b2b/${codigoA.id}`), 404, 'Código de descuento no encontrado');
    expect(await s.h.prisma.pedidoB2bCodigoDescuento.count({ where: { tenantId: s.base.tenant.id } })).toBe(1);
    const usosA = await apiA().get('/codigos-descuento-b2b').expect(200);
    expect({ codigo: usosA.body[0].codigo, usosActuales: usosA.body[0].usosActuales }).toStrictEqual({ codigo: 'SOLOA', usosActuales: 1 });
  });

  it('los Clientes B2B de cada tenant son independientes (mismo directorio /clientes, filtrado por tenant)', async () => {
    const clientesB = await apiB().get('/clientes').expect(200);
    expect(clientesB.body.data.map((c: any) => [c.nombre, c.canal])).toStrictEqual([['Luis Compras', 'B2B']]);
    expect(clientesB.body.total).toBe(1);
    const clientesA = await apiA().get('/clientes').expect(200);
    expect(clientesA.body.total).toBe(2);
  });

  it('storefront público: B no usa productos ni códigos de A; el catálogo e info de B son de B', async () => {
    expectError(
      await postPublicoB2b(s.h, b.tenant.slug, bodyB2b(b, { items: [{ productId: s.base.productoA.id, distribucion: [{ dia: 'LUNES', cantidad: 12 }] }] })),
      404,
      'Uno o más productos no existen en este negocio',
    );
    expectError(
      await postPublicoB2b(s.h, b.tenant.slug, bodyB2b(b, { codigoDescuento: 'SOLOA' })),
      404,
      'El código de descuento no existe o no está activo',
    );
    expectError(
      await request(s.h.app.getHttpServer()).get(`/public/pedidos-b2b/tenants/${b.tenant.slug}/codigos-descuento/SOLOA`),
      404,
      'El código de descuento no existe o no está activo',
    );
    const cat = await request(s.h.app.getHttpServer()).get(`/public/pedidos-b2b/tenants/${b.tenant.slug}/catalog`).expect(200);
    const ids = cat.body.categories.flatMap((c: any) => c.products.map((p: any) => p.id)).sort();
    expect(ids).toStrictEqual([b.productoA.id, b.productoB.id].sort());
    const info = await request(s.h.app.getHttpServer()).get(`/public/pedidos-b2b/tenants/${b.tenant.slug}`).expect(200);
    expect(info.body.nombre).toBe('Negocio otro-mayoreo');
  });
});
