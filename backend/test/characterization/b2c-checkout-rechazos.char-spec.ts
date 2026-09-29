import { conectarStripe, horarioAbierto, seedBase, seedModificadores, seedPuntoEnvio } from './db';
import { bodyCheckout, cederEventLoop, postCheckout, usarSuite } from './helpers';

// Área 2 · Checkout, rechazos. Cada rechazo NO deja rastro: sin Order, sin Cliente, sin job, sin PaymentIntent.
describe('B2C · checkout, rechazos', () => {
  const s = usarSuite();

  async function sinEfectos() {
    await cederEventLoop();
    expect(await s.h.prisma.order.count()).toBe(0);
    expect(await s.h.prisma.orderItem.count()).toBe(0);
    expect(await s.h.prisma.cliente.count()).toBe(0);
    expect(s.h.fakes.queueAdd).not.toHaveBeenCalled();
    expect(s.h.fakes.paymentIntentsCreate).not.toHaveBeenCalled();
  }

  async function rechaza(body: Record<string, unknown>, status: number, message: string | string[]) {
    const res = await postCheckout(s.h, s.base.tenant.slug, body);
    expect(res.status).toBe(status);
    expect(res.body.message).toEqual(message);
    await sinEfectos();
    return res;
  }

  it('forma completa del error (Nest): { message, error, statusCode }', async () => {
    const res = await rechaza(bodyCheckout(s.base, { metodoPago: 'TRANSFERENCIA' }), 409, 'Ese método de pago no está disponible todavía');
    expect(res.body).toEqual({
      message: 'Ese método de pago no está disponible todavía',
      error: 'Conflict',
      statusCode: 409,
    });
  });

  it('negocio inexistente: 404', async () => {
    const res = await postCheckout(s.h, 'no-existe', bodyCheckout(s.base));
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Negocio no encontrado');
  });

  it('negocio cerrado en este momento: 409', async () => {
    await s.h.prisma.tenant.update({
      where: { id: s.base.tenant.id },
      data: { horarioAtencion: horarioAbierto('23:00', '23:30') as any }, // ahora son las 10:00
    });
    await rechaza(bodyCheckout(s.base), 409, 'El negocio está cerrado en este momento');
  });

  describe('hora de recogida', () => {
    it('RECOGER sin horaRecogidaTipo: 400', async () => {
      const body: any = bodyCheckout(s.base);
      delete body.horaRecogidaTipo;
      await rechaza(body, 400, 'horaRecogidaTipo es obligatorio');
    });

    it('HORA_ESPECIFICA sin hora: 400', async () => {
      await rechaza(bodyCheckout(s.base, { horaRecogidaTipo: 'HORA_ESPECIFICA' }), 400, 'Elige una hora de recogida');
    });

    it('con menos de 15 min de margen (10:05 cuando son las 10:00): 400 con el rango permitido', async () => {
      await rechaza(
        bodyCheckout(s.base, { horaRecogidaTipo: 'HORA_ESPECIFICA', horaRecogida: '10:05' }),
        400,
        'Elige una hora de recogida entre 10:15 y 22:00',
      );
    });

    it('fuera del horario (después del cierre): 400', async () => {
      await rechaza(
        bodyCheckout(s.base, { horaRecogidaTipo: 'HORA_ESPECIFICA', horaRecogida: '22:00' }),
        400,
        'Elige una hora de recogida entre 10:15 y 22:00',
      );
    });

    it('formato inválido: 400 de validación', async () => {
      await rechaza(bodyCheckout(s.base, { horaRecogidaTipo: 'HORA_ESPECIFICA', horaRecogida: '25:99' }), 400, [
        'horaRecogida debe tener formato HH:mm',
      ]);
    });
  });

  describe('productos', () => {
    it('producto no disponible: 409', async () => {
      await s.h.prisma.product.update({ where: { id: s.base.productoB.id }, data: { disponible: false } });
      await rechaza(
        bodyCheckout(s.base, { items: [{ productId: s.base.productoB.id, cantidad: 1 }] }),
        409,
        '"Concha" ya no está disponible',
      );
    });

    it('producto de categoría inactiva: 409', async () => {
      await s.h.prisma.category.update({ where: { id: s.base.categoria.id }, data: { activa: false } });
      await rechaza(bodyCheckout(s.base), 409, '"Café americano" ya no está disponible');
    });

    it('producto de otro tenant: 404 (no confirma que existe)', async () => {
      const otro = await seedBase(s.h.prisma, { slug: 'otro-negocio' });
      await rechaza(
        bodyCheckout(s.base, { items: [{ productId: otro.productoA.id, cantidad: 1 }] }),
        404,
        'Uno o más productos no existen en este negocio',
      );
    });

    it('validación de items: vacío, cantidad 0, id no UUID', async () => {
      await rechaza(bodyCheckout(s.base, { items: [] }), 400, ['items must contain at least 1 elements']);
      await rechaza(bodyCheckout(s.base, { items: [{ productId: s.base.productoA.id, cantidad: 0 }] }), 400, [
        'items.0.cantidad must be a positive number',
      ]);
      await rechaza(bodyCheckout(s.base, { items: [{ productId: 'x', cantidad: 1 }] }), 400, [
        'items.0.productId must be a UUID',
      ]);
    });

    it('teléfono demasiado corto: 400', async () => {
      await rechaza(bodyCheckout(s.base, { clienteTelefono: '123' }), 400, [
        'clienteTelefono must be longer than or equal to 7 characters',
      ]);
    });
  });

  describe('método de pago', () => {
    it('TRANSFERENCIA: 409 (no implementada)', async () => {
      await rechaza(bodyCheckout(s.base, { metodoPago: 'TRANSFERENCIA' }), 409, 'Ese método de pago no está disponible todavía');
    });

    it('TARJETA sin cuenta Stripe conectada: 409, sin tocar Stripe', async () => {
      await rechaza(bodyCheckout(s.base, { metodoPago: 'TARJETA' }), 409, 'Este negocio no acepta pagos con tarjeta todavía');
      expect(s.h.fakes.refundsCreate).not.toHaveBeenCalled();
    });

    it('TARJETA con cuenta pero charges no habilitados: 409', async () => {
      await conectarStripe(s.h.prisma, s.base.tenant.id, false);
      await rechaza(bodyCheckout(s.base, { metodoPago: 'TARJETA' }), 409, 'Este negocio no acepta pagos con tarjeta todavía');
    });
  });

  describe('facturación', () => {
    it('OBLIGATORIO sin requiereFactura: 400', async () => {
      await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { facturacionModo: 'OBLIGATORIO' } });
      await rechaza(bodyCheckout(s.base), 400, 'Este negocio requiere factura para todos los pedidos');
    });

    it('requiereFactura=true con datos faltantes: 400 con los campos', async () => {
      await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { facturacionModo: 'OPCIONAL' } });
      await rechaza(
        bodyCheckout(s.base, { requiereFactura: true, facturaRfc: 'CCE010101AB1' }),
        400,
        'Faltan datos de factura: facturaRazonSocial, facturaRegimenFiscal, facturaUsoCfdi, facturaCodigoPostal, facturaCorreo',
      );
    });
  });

  describe('entrega a domicilio', () => {
    const direccion = { direccionCalle: 'Calle Roble', direccionNumero: '12', direccionColonia: 'Del Valle' };

    it('DOMICILIO sin puntoEnvioId: 400', async () => {
      await rechaza(bodyCheckout(s.base, { metodoEntrega: 'DOMICILIO', ...direccion }), 400, 'Elige un punto de envío');
    });

    it('zona inactiva: 404', async () => {
      const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id, { activo: false });
      await rechaza(
        bodyCheckout(s.base, { metodoEntrega: 'DOMICILIO', puntoEnvioId: punto.id, ...direccion }),
        404,
        'Punto de envío no encontrado',
      );
    });

    it('zona de otro tenant: 404', async () => {
      const otro = await seedBase(s.h.prisma, { slug: 'otro-negocio' });
      const punto = await seedPuntoEnvio(s.h.prisma, otro.tenant.id);
      await rechaza(
        bodyCheckout(s.base, { metodoEntrega: 'DOMICILIO', puntoEnvioId: punto.id, ...direccion }),
        404,
        'Punto de envío no encontrado',
      );
    });

    it('sin dirección: 400 con los campos faltantes', async () => {
      const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
      await rechaza(
        bodyCheckout(s.base, { metodoEntrega: 'DOMICILIO', puntoEnvioId: punto.id, direccionCalle: '   ' }),
        400,
        'Faltan datos de dirección: direccionCalle, direccionNumero, direccionColonia',
      );
    });

    it('pedido mínimo de la zona no alcanzado: 409 con el faltante', async () => {
      const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id, { nombre: 'Zona Norte', pedidoMinimo: '200.00' });
      await rechaza(
        bodyCheckout(s.base, { metodoEntrega: 'DOMICILIO', puntoEnvioId: punto.id, ...direccion }),
        409,
        'El pedido mínimo para "Zona Norte" es $200.00 — te faltan $155.00',
      );
    });
  });

  describe('modificadores', () => {
    async function seedTam(opts: { obligatorio: boolean; tipo: 'UNICA' | 'MULTIPLE' }) {
      return seedModificadores(s.h.prisma, s.base.tenant.id, s.base.productoA.id, {
        nombre: 'Tamaño',
        tipoSeleccion: opts.tipo,
        obligatorio: opts.obligatorio,
        opciones: [
          { nombre: 'Chica', precioAdicional: '0.00' },
          { nombre: 'Grande', precioAdicional: '30.00' },
        ],
      });
    }

    it('grupo UNICA obligatorio sin selección: 400', async () => {
      await seedTam({ obligatorio: true, tipo: 'UNICA' });
      await rechaza(bodyCheckout(s.base), 400, 'Elige una opción de "Tamaño"');
    });

    it('grupo MULTIPLE obligatorio sin selección: 400', async () => {
      await seedTam({ obligatorio: true, tipo: 'MULTIPLE' });
      await rechaza(bodyCheckout(s.base), 400, 'Elige al menos una opción de "Tamaño"');
    });

    it('grupo UNICA con más de una opción (aunque sea opcional): 400', async () => {
      const { opciones } = await seedTam({ obligatorio: false, tipo: 'UNICA' });
      await rechaza(
        bodyCheckout(s.base, {
          items: [{ productId: s.base.productoA.id, cantidad: 1, modifierOptionIds: [opciones[0].id, opciones[1].id] }],
        }),
        400,
        '"Tamaño" solo admite una opción',
      );
    });

    it('opción que no pertenece al producto (o es de otro tenant): 404', async () => {
      const otro = await seedBase(s.h.prisma, { slug: 'otro-negocio' });
      const ajeno = await seedModificadores(s.h.prisma, otro.tenant.id, otro.productoA.id, {
        opciones: [{ nombre: 'Ajena', precioAdicional: '1.00' }],
      });
      await rechaza(
        bodyCheckout(s.base, {
          items: [{ productId: s.base.productoA.id, cantidad: 1, modifierOptionIds: [ajeno.opciones[0].id] }],
        }),
        404,
        'Una opción seleccionada no está disponible para este producto',
      );
    });
  });
});
