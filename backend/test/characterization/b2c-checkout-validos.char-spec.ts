import { claves, normalizar } from './normalizar';
import { conectarStripe, seedModificadores, seedPromocion, seedPuntoEnvio } from './db';
import { bodyCheckout, CLAVES_ITEM, CLAVES_ORDER, cederEventLoop, postCheckout, usarSuite } from './helpers';
import { waitForCalls } from './harness';

// Área 1 · Checkout, casos válidos (el caso base EFECTIVO/RECOGER está en b2c-checkout.char-spec.ts).
describe('B2C · checkout, casos válidos', () => {
  const s = usarSuite();

  it('EFECTIVO + RECOGER con hora específica: guarda la hora y encola PEDIDO_RECIBIDO', async () => {
    const res = await postCheckout(
      s.h,
      s.base.tenant.slug,
      bodyCheckout(s.base, { horaRecogidaTipo: 'HORA_ESPECIFICA', horaRecogida: '10:30', notas: 'Sin azúcar' }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      horaRecogidaTipo: 'HORA_ESPECIFICA',
      horaRecogida: '10:30',
      notas: 'Sin azúcar',
      metodoEntrega: 'RECOGER',
    });
    await waitForCalls(s.h.fakes.queueAdd);
  });

  it('TARJETA: crea el PaymentIntent (destination charge, sin comisión), responde con clientSecret y NO encola PEDIDO_RECIBIDO', async () => {
    await conectarStripe(s.h.prisma, s.base.tenant.id);
    const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { metodoPago: 'TARJETA' }));

    expect(res.status).toBe(201);
    // Conjunto exacto de claves: las de Order + clientSecret.
    expect(claves(res.body)).toEqual([...CLAVES_ORDER, 'clientSecret'].sort());
    expect(res.body).toMatchObject({
      metodoPago: 'TARJETA',
      estadoPago: 'PENDIENTE',
      stripePaymentIntentId: 'pi_char_1',
      clientSecret: 'pi_char_1_secret_x',
      total: '45',
    });

    expect(s.h.fakes.paymentIntentsCreate).toHaveBeenCalledTimes(1);
    expect(s.h.fakes.paymentIntentsCreate.mock.calls[0][0]).toEqual({
      amount: 4500,
      currency: 'mxn',
      transfer_data: { destination: `acct_char_${s.base.tenant.id.slice(0, 8)}` },
      automatic_payment_methods: { enabled: true },
      metadata: { orderId: res.body.id, tenantId: s.base.tenant.id, slug: s.base.tenant.slug, folio: '1' },
    });

    // Sin application_fee_amount (0% de comisión) y sin notificación hasta que el webhook confirme el pago.
    expect(s.h.fakes.paymentIntentsCreate.mock.calls[0][0]).not.toHaveProperty('application_fee_amount');
    await cederEventLoop();
    expect(s.h.fakes.queueAdd).not.toHaveBeenCalled();
  });

  it('DOMICILIO con punto de envío y dirección: recorta espacios y fuerza hora a LO_ANTES_POSIBLE/null', async () => {
    const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id, { pedidoMinimo: '50.00' });
    const res = await postCheckout(
      s.h,
      s.base.tenant.slug,
      bodyCheckout(s.base, {
        metodoEntrega: 'DOMICILIO',
        puntoEnvioId: punto.id,
        direccionCalle: '  Calle Roble  ',
        direccionNumero: ' 12-B ',
        direccionColonia: ' Del Valle ',
        direccionReferencias: ' Portón azul ',
        // Lo que mande el cliente para hora se ignora en DOMICILIO.
        horaRecogidaTipo: 'HORA_ESPECIFICA',
        horaRecogida: '11:00',
        items: [{ productId: s.base.productoA.id, cantidad: 2 }],
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      metodoEntrega: 'DOMICILIO',
      puntoEnvioId: punto.id,
      direccionCalle: 'Calle Roble',
      direccionNumero: '12-B',
      direccionColonia: 'Del Valle',
      direccionReferencias: 'Portón azul',
      horaRecogidaTipo: 'LO_ANTES_POSIBLE',
      horaRecogida: null,
      total: '90',
    });
    await waitForCalls(s.h.fakes.queueAdd);
  });

  it('DOMICILIO sin referencias: direccionReferencias queda null', async () => {
    const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
    const res = await postCheckout(
      s.h,
      s.base.tenant.slug,
      bodyCheckout(s.base, {
        metodoEntrega: 'DOMICILIO',
        puntoEnvioId: punto.id,
        direccionCalle: 'Calle Roble',
        direccionNumero: '12',
        direccionColonia: 'Del Valle',
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.direccionReferencias).toBeNull();
    await waitForCalls(s.h.fakes.queueAdd);
  });

  describe('facturación', () => {
    const factura = {
      requiereFactura: true,
      facturaRazonSocial: 'Cafés del Centro SA de CV',
      facturaRfc: 'CCE010101AB1',
      facturaRegimenFiscal: '601',
      facturaUsoCfdi: 'G03',
      facturaCodigoPostal: '06000',
      facturaCorreo: 'facturas@cafes.test',
    };

    it('OPCIONAL + requiereFactura=true: guarda los 6 campos fiscales', async () => {
      await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { facturacionModo: 'OPCIONAL' } });
      const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, factura));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject(factura);
      await waitForCalls(s.h.fakes.queueAdd);
    });

    it('OPCIONAL sin requiereFactura: ignora los campos fiscales aunque vengan', async () => {
      await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { facturacionModo: 'OPCIONAL' } });
      const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { ...factura, requiereFactura: false }));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        requiereFactura: false,
        facturaRazonSocial: null,
        facturaRfc: null,
        facturaRegimenFiscal: null,
        facturaUsoCfdi: null,
        facturaCodigoPostal: null,
        facturaCorreo: null,
      });
      await waitForCalls(s.h.fakes.queueAdd);
    });

    it('OBLIGATORIO con datos completos: guarda la factura', async () => {
      await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { facturacionModo: 'OBLIGATORIO' } });
      const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, factura));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject(factura);
      await waitForCalls(s.h.fakes.queueAdd);
    });

    it('DESACTIVADO: ignora por completo los campos fiscales', async () => {
      const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, factura));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ requiereFactura: false, facturaRfc: null, facturaCorreo: null });
      await waitForCalls(s.h.fakes.queueAdd);
    });
  });

  describe('modificadores', () => {
    async function seedGrupos() {
      const tam = await seedModificadores(s.h.prisma, s.base.tenant.id, s.base.productoA.id, {
        nombre: 'Tamaño',
        tipoSeleccion: 'UNICA',
        obligatorio: true,
        orden: 0,
        opciones: [
          { nombre: 'Chica', precioAdicional: '0.00' },
          { nombre: 'Grande', precioAdicional: '30.00' },
        ],
      });
      const extras = await seedModificadores(s.h.prisma, s.base.tenant.id, s.base.productoA.id, {
        nombre: 'Extras',
        tipoSeleccion: 'MULTIPLE',
        obligatorio: false,
        orden: 1,
        opciones: [
          { nombre: 'Shot extra', precioAdicional: '10.00' },
          { nombre: 'Leche de avena', precioAdicional: '8.50' },
        ],
      });
      return { tam, extras };
    }

    it('suma el extra completo (× cantidad), ordena por grupo y guarda snapshot en OrderItemModifier', async () => {
      const { tam, extras } = await seedGrupos();
      const [chica, grande] = tam.opciones;
      const [shot, avena] = extras.opciones;
      void chica;

      const res = await postCheckout(
        s.h,
        s.base.tenant.slug,
        bodyCheckout(s.base, {
          // Orden "desordenado" a propósito: lo persistido sigue ProductModifierGroup.orden, no el del body.
          items: [{ productId: s.base.productoA.id, cantidad: 2, modifierOptionIds: [shot.id, grande.id, avena.id] }],
        }),
      );

      expect(res.status).toBe(201);
      // subtotal 2×45 = 90; extra por unidad 30+10+8.5 = 48.5 ×2 = 97 → 187
      expect(res.body.total).toBe('187');
      expect(claves(res.body.items[0])).toEqual([...CLAVES_ITEM, 'modificadores'].sort());
      expect(res.body.items[0].modificadores).toEqual([
        { nombreGrupo: 'Tamaño', nombre: 'Grande', precioAdicional: '30' },
        { nombreGrupo: 'Extras', nombre: 'Shot extra', precioAdicional: '10' },
        { nombreGrupo: 'Extras', nombre: 'Leche de avena', precioAdicional: '8.5' },
      ]);

      const filas = await s.h.prisma.orderItemModifier.findMany({ orderBy: { nombre: 'asc' } });
      expect(
        normalizar(filas, { [s.base.tenant.id]: 'tenant', [res.body.items[0].id]: 'item', [grande.id]: 'grande', [shot.id]: 'shot', [avena.id]: 'avena' }),
      ).toEqual([
        { id: '<uuid>', tenantId: '<tenant>', orderItemId: '<item>', modifierOptionId: '<grande>', nombreGrupo: 'Tamaño', nombre: 'Grande', precioAdicional: '30' },
        { id: '<uuid>', tenantId: '<tenant>', orderItemId: '<item>', modifierOptionId: '<avena>', nombreGrupo: 'Extras', nombre: 'Leche de avena', precioAdicional: '8.5' },
        { id: '<uuid>', tenantId: '<tenant>', orderItemId: '<item>', modifierOptionId: '<shot>', nombreGrupo: 'Extras', nombre: 'Shot extra', precioAdicional: '10' },
      ]);
      await waitForCalls(s.h.fakes.queueAdd);
    });

    it('dos líneas del mismo producto con modificadores distintos = dos OrderItem (no se fusionan)', async () => {
      const { tam } = await seedGrupos();
      const [chica, grande] = tam.opciones;
      const res = await postCheckout(
        s.h,
        s.base.tenant.slug,
        bodyCheckout(s.base, {
          items: [
            { productId: s.base.productoA.id, cantidad: 1, modifierOptionIds: [chica.id] },
            { productId: s.base.productoA.id, cantidad: 1, modifierOptionIds: [grande.id] },
          ],
        }),
      );
      expect(res.status).toBe(201);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe('120'); // 45 + 45 + 30
      await waitForCalls(s.h.fakes.queueAdd);
    });
  });

  describe('descuentos', () => {
    it('combo: aplica el precio del combo y arma notasDescuento', async () => {
      await seedPromocion(s.h.prisma, s.base.tenant.id, 'COMBO', {
        productIds: [s.base.productoA.id, s.base.productoB.id],
        precioCombo: 60,
      });
      const res = await postCheckout(
        s.h,
        s.base.tenant.slug,
        bodyCheckout(s.base, {
          items: [
            { productId: s.base.productoA.id, cantidad: 1 },
            { productId: s.base.productoB.id, cantidad: 1 },
          ],
        }),
      );
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ descuentoTotal: '15.5', notasDescuento: 'Combo Café americano + Concha x1', total: '60' });
      // Precio de lista congelado por línea (el descuento vive en la orden, no en el item).
      expect(res.body.items.map((i: any) => i.precioUnitario).sort()).toEqual(['30.5', '45']);
      await waitForCalls(s.h.fakes.queueAdd);
    });

    it('descuento por producto (porcentaje)', async () => {
      await seedPromocion(s.h.prisma, s.base.tenant.id, 'DESCUENTO_PRODUCTO', {
        productId: s.base.productoA.id,
        tipoDescuento: 'porcentaje',
        valor: 10,
      });
      const res = await postCheckout(
        s.h,
        s.base.tenant.slug,
        bodyCheckout(s.base, { items: [{ productId: s.base.productoA.id, cantidad: 2 }] }),
      );
      expect(res.body).toMatchObject({ descuentoTotal: '9', notasDescuento: 'Café americano x2 (-10%)', total: '81' });
      await waitForCalls(s.h.fakes.queueAdd);
    });

    it('descuento por producto (monto fijo)', async () => {
      await seedPromocion(s.h.prisma, s.base.tenant.id, 'DESCUENTO_PRODUCTO', {
        productId: s.base.productoA.id,
        tipoDescuento: 'monto_fijo',
        valor: 5,
      });
      const res = await postCheckout(
        s.h,
        s.base.tenant.slug,
        bodyCheckout(s.base, { items: [{ productId: s.base.productoA.id, cantidad: 2 }] }),
      );
      expect(res.body).toMatchObject({ descuentoTotal: '10', notasDescuento: 'Café americano x2 (-$5)', total: '80' });
      await waitForCalls(s.h.fakes.queueAdd);
    });

    it('los modificadores nunca se descuentan: combo + modificador = total del combo + extra completo', async () => {
      await seedPromocion(s.h.prisma, s.base.tenant.id, 'COMBO', {
        productIds: [s.base.productoA.id, s.base.productoB.id],
        precioCombo: 60,
      });
      const { opciones } = await seedModificadores(s.h.prisma, s.base.tenant.id, s.base.productoA.id, {
        opciones: [{ nombre: 'Grande', precioAdicional: '30.00' }],
      });
      const res = await postCheckout(
        s.h,
        s.base.tenant.slug,
        bodyCheckout(s.base, {
          items: [
            { productId: s.base.productoA.id, cantidad: 1, modifierOptionIds: [opciones[0].id] },
            { productId: s.base.productoB.id, cantidad: 1 },
          ],
        }),
      );
      // 75.5 subtotal + 30 extra − 15.5 descuento del combo = 90
      expect(res.body).toMatchObject({ descuentoTotal: '15.5', total: '90' });
      await waitForCalls(s.h.fakes.queueAdd);
    });
  });

  it('un body con precio/total/estado inventados no altera lo que calcula el servidor', async () => {
    const res = await postCheckout(
      s.h,
      s.base.tenant.slug,
      bodyCheckout(s.base, {
        total: 1,
        precio: 1,
        descuentoTotal: 999,
        estadoPago: 'FALLIDO',
        estadoPedido: 'DESPACHADO',
        folio: '999',
        items: [{ productId: s.base.productoA.id, cantidad: 1, precioUnitario: 1, precio: 1 }],
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      total: '45',
      descuentoTotal: '0',
      estadoPago: 'PAGADO',
      estadoPedido: 'PENDIENTE_CONFIRMACION',
      folio: '1',
    });
    expect(res.body.items[0].precioUnitario).toBe('45');
    await waitForCalls(s.h.fakes.queueAdd);
  });
});
