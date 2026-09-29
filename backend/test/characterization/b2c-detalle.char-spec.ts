import { tokenFor } from './auth';
import { seedModificadores, seedPromocion, seedPuntoEnvio } from './db';
import { etiquetasOrder, expectExacto, itemEsperado, ordenEsperada } from './exacto';
import { auth, bodyCheckout, postCheckout, usarSuite } from './helpers';
import { waitForCalls } from './harness';

// Ajuste 0b-1 · GET /orders/:id con igualdad estricta sobre un pedido DOMICILIO completo:
// punto de envío + dirección + factura + modificadores + descuento. Los campos de entrega y
// factura son justo los que se mueven a DetalleB2C en la etapa 1.
describe('B2C · GET /orders/:id de un pedido DOMICILIO completo', () => {
  const s = usarSuite();

  it('devuelve exactamente todos los campos de entrega, factura y totales (los modificadores no viajan en findOne)', async () => {
    await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { facturacionModo: 'OPCIONAL' } });
    const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id, { nombre: 'Zona Centro', pedidoMinimo: '50.00' });
    await seedPromocion(s.h.prisma, s.base.tenant.id, 'DESCUENTO_PRODUCTO', {
      productId: s.base.productoB.id,
      tipoDescuento: 'porcentaje',
      valor: 10,
    });
    const tam = await seedModificadores(s.h.prisma, s.base.tenant.id, s.base.productoA.id, {
      nombre: 'Tamaño',
      obligatorio: true,
      orden: 0,
      opciones: [{ nombre: 'Grande', precioAdicional: '30.00' }],
    });
    const extras = await seedModificadores(s.h.prisma, s.base.tenant.id, s.base.productoA.id, {
      nombre: 'Extras',
      tipoSeleccion: 'MULTIPLE',
      orden: 1,
      opciones: [{ nombre: 'Shot extra', precioAdicional: '10.00' }],
    });

    const creado = await postCheckout(
      s.h,
      s.base.tenant.slug,
      bodyCheckout(s.base, {
        clienteCorreo: 'ana@test.com',
        notas: 'Tocar el timbre dos veces',
        metodoEntrega: 'DOMICILIO',
        puntoEnvioId: punto.id,
        direccionCalle: 'Calle Roble',
        direccionNumero: '12-B',
        direccionColonia: 'Del Valle',
        direccionReferencias: 'Portón azul',
        requiereFactura: true,
        facturaRazonSocial: 'Cafés del Centro SA de CV',
        facturaRfc: 'CCE010101AB1',
        facturaRegimenFiscal: '601',
        facturaUsoCfdi: 'G03',
        facturaCodigoPostal: '06000',
        facturaCorreo: 'facturas@cafes.test',
        items: [
          { productId: s.base.productoA.id, cantidad: 2, modifierOptionIds: [extras.opciones[0].id, tam.opciones[0].id] },
          { productId: s.base.productoB.id, cantidad: 2 },
        ],
      }),
    );
    expect(creado.status).toBe(201);
    await waitForCalls(s.h.fakes.queueAdd);

    const token = tokenFor(s.h.jwt, s.base.dueno, s.base.tenant.id, 'DUENO');
    const res = await auth(s.h, token).get(`/orders/${creado.body.id}`).expect(200);

    // subtotal 2×45 + 2×30.5 = 151; extras (30+10)×2 = 80; descuento 10% de Concha = 6.1 → 224.9
    expectExacto(
      res.body,
      ordenEsperada({
        clienteCorreo: 'ana@test.com',
        notas: 'Tocar el timbre dos veces',
        metodoEntrega: 'DOMICILIO',
        puntoEnvioId: '<punto>',
        direccionCalle: 'Calle Roble',
        direccionNumero: '12-B',
        direccionColonia: 'Del Valle',
        direccionReferencias: 'Portón azul',
        requiereFactura: true,
        facturaRazonSocial: 'Cafés del Centro SA de CV',
        facturaRfc: 'CCE010101AB1',
        facturaRegimenFiscal: '601',
        facturaUsoCfdi: 'G03',
        facturaCodigoPostal: '06000',
        facturaCorreo: 'facturas@cafes.test',
        descuentoTotal: '6.1',
        notasDescuento: 'Concha x2 (-10%)',
        total: '224.9',
        items: [
          itemEsperado({ cantidad: 2 }),
          itemEsperado({ productId: '<productoB>', nombreProducto: 'Concha', precioUnitario: '30.5', cantidad: 2 }),
        ],
      }),
      etiquetasOrder(s.base, res.body, { [punto.id]: 'punto' }),
    );
  });
});
