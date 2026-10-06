import { configurarB2b, seedBase, seedCodigoDescuento } from './db';
import { expectError, expectExacto } from './exacto';
import { cederEventLoop, usarSuite } from './helpers';
import {
  bodyB2b,
  diaEsperado,
  etiquetasB2b,
  itemB2bEsperado,
  pedidoB2bEsperado,
  postPublicoB2b,
  SEMANA_ACTUAL,
  SEMANA_PASADA,
  SEMANA_PROXIMA,
} from './b2b-helpers';

// 0b-1 · Áreas 1 y 2 · Creación pública B2B (POST /public/pedidos-b2b/tenants/:slug/pedidos).
describe('B2B · creación pública, casos válidos', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const post = (extra: Record<string, unknown> = {}) => postPublicoB2b(s.h, s.base.tenant.slug, bodyB2b(s.base, extra));
  const exacto = (body: any, esperado: unknown, extra: Record<string, string> = {}) =>
    expectExacto(body, esperado, etiquetasB2b(s.base, body, extra));

  it('AL_FINAL sin factura ni código: respuesta exacta, filas (pedido, items, días) y Cliente B2B', async () => {
    const res = await post();
    expect(res.status).toBe(201);
    exacto(res.body, pedidoB2bEsperado());

    expect(await s.h.prisma.order.count({ where: { tipo: 'B2B' } })).toBe(1);
    expect(await s.h.prisma.orderItem.count({ where: { order: { tipo: 'B2B' } } })).toBe(2);
    expect(await s.h.prisma.entregaItem.count()).toBe(3); // Etapa 2: los días son EntregaItem
    expect((await s.h.prisma.detalleB2B.findMany())[0].semanaInicio.toISOString()).toBe('2026-10-05T00:00:00.000Z');

    const clientes = await s.h.prisma.cliente.findMany();
    expect(clientes).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(clientes[0]))).toStrictEqual({
      id: res.body.clienteId,
      tenantId: s.base.tenant.id,
      canal: 'B2B',
      telefono: '5533334444',
      nombre: 'Luis Compras',
      correo: 'compras@laesquina.test',
      primerPedidoAt: '2026-09-30T16:00:00.000Z',
      ultimoPedidoAt: '2026-09-30T16:00:00.000Z',
      totalPedidos: 1,
      createdAt: '2026-09-30T16:00:00.000Z',
      updatedAt: '2026-09-30T16:00:00.000Z',
    });

    // BUG/HUECO CONGELADO: crear un pedido B2B no dispara ninguna notificación ni regla.
    await cederEventLoop();
    expect(s.h.fakes.queueAdd).not.toHaveBeenCalled();
    expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();
  });

  it('el campo semanaInicio se serializa como fecha-hora UTC a medianoche', async () => {
    const res = await post();
    expect(res.body.semanaInicio).toBe('2026-10-05T00:00:00.000Z');
  });

  it('con código de descuento (insensible a mayúsculas): snapshot de texto/porcentaje y descuento sobre el subtotal', async () => {
    const codigo = await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'PROMO10', porcentaje: '10.00' });
    const res = await post({ codigoDescuento: ' promo10 ' });
    expect(res.status).toBe(201);
    // 662 − 10% (66.2) = 595.8
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

  it('con factura (OPCIONAL + requiereFactura): guarda los 6 campos fiscales', async () => {
    await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { facturacionModo: 'OPCIONAL' } });
    const res = await post({
      requiereFactura: true,
      facturaRazonSocial: 'Cafetería La Esquina SA de CV',
      facturaRfc: 'CLE010101AB1',
      facturaRegimenFiscal: '601',
      facturaUsoCfdi: 'G03',
      facturaCodigoPostal: '06000',
      facturaCorreo: 'facturas@laesquina.test',
    });
    expect(res.status).toBe(201);
    exacto(
      res.body,
      pedidoB2bEsperado({
        requiereFactura: true,
        facturaRazonSocial: 'Cafetería La Esquina SA de CV',
        facturaRfc: 'CLE010101AB1',
        facturaRegimenFiscal: '601',
        facturaUsoCfdi: 'G03',
        facturaCodigoPostal: '06000',
        facturaCorreo: 'facturas@laesquina.test',
      }),
    );
  });

  it('facturación DESACTIVADO: ignora los campos fiscales aunque vengan', async () => {
    const res = await post({ requiereFactura: true, facturaRfc: 'CLE010101AB1', facturaCorreo: 'x@y.test' });
    expect(res.status).toBe(201);
    exacto(res.body, pedidoB2bEsperado());
  });

  it('los días con cantidad 0 no se guardan; un producto con varios días y varios productos suman piezas y subtotal', async () => {
    const res = await post({
      items: [
        {
          productId: s.base.productoA.id,
          distribucion: [
            { dia: 'LUNES', cantidad: 6 },
            { dia: 'MARTES', cantidad: 0 },
            { dia: 'MIERCOLES', cantidad: 6 },
          ],
        },
        { productId: s.base.productoB.id, distribucion: [{ dia: 'VIERNES', cantidad: 4 }] },
      ],
    });
    expect(res.status).toBe(201);
    exacto(res.body, pedidoB2bEsperado());
    expect(await s.h.prisma.entregaItem.count()).toBe(3);
  });

  // CAMBIO PERMITIDO DE LA ETAPA 2 (acordado): antes el mismo producto en dos items se guardaba como dos items
  // separados; ahora se consolida en UN solo item con las cantidades por día sumadas. Totales y piezas no cambian.
  it('el mismo producto en dos items se consolida en un solo item (Etapa 2)', async () => {
    const res = await post({
      items: [
        { productId: s.base.productoA.id, distribucion: [{ dia: 'LUNES', cantidad: 5 }] },
        { productId: s.base.productoA.id, distribucion: [{ dia: 'MARTES', cantidad: 5 }] },
      ],
    });
    expect(res.status).toBe(201);
    expectExacto(
      res.body,
      pedidoB2bEsperado({
        totalPiezas: 10,
        subtotal: '450',
        total: '450',
        items: [itemB2bEsperado({ cantidadTotal: 10, distribucion: [diaEsperado('LUNES', 5, 0), diaEsperado('MARTES', 5, 0)] }, 0)],
      }),
      etiquetasB2b(s.base, res.body),
    );
  });

  it('un pedido por debajo del mínimo de piezas SÍ se crea (el mínimo se valida al confirmar/pagar)', async () => {
    const res = await post({ items: [{ productId: s.base.productoB.id, distribucion: [{ dia: 'VIERNES', cantidad: 2 }] }] });
    expect(res.status).toBe(201);
    expect(res.body.totalPiezas).toBe(2);
    expect(res.body.minimoPiezasAplicado).toBe(10);
  });

  it('semanas pasadas y la semana en curso también se aceptan (no se valida que sea futura)', async () => {
    expect((await post({ semanaInicio: SEMANA_PASADA })).status).toBe(201);
    expect((await post({ semanaInicio: SEMANA_ACTUAL })).status).toBe(201);
  });

  it('el mínimo y el modo de cobro del tenant se copian al pedido (snapshot)', async () => {
    await configurarB2b(s.h.prisma, s.base.tenant.id, { minimoPiezas: 25 });
    const res = await post();
    expect(res.body.minimoPiezasAplicado).toBe(25);
    await configurarB2b(s.h.prisma, s.base.tenant.id, { minimoPiezas: 5 });
    const otro = await post({ contactoTelefono: '5500000001' });
    expect(otro.body.minimoPiezasAplicado).toBe(5);
    // el primero no cambia retroactivamente
    expect((await s.h.prisma.detalleB2B.findUniqueOrThrow({ where: { orderId: res.body.id } })).minimoPiezasAplicado).toBe(25);
  });

  it('recompra del mismo contacto (otro formato de teléfono): un solo Cliente B2B con totalPedidos 2', async () => {
    await post({ contactoTelefono: '+52 55 3333 4444' });
    jest.setSystemTime(new Date('2026-09-30T18:00:00.000Z'));
    await post({ contactoTelefono: '55-3333-4444', contactoNombre: 'Luis C. Nuevo' });
    const clientes = await s.h.prisma.cliente.findMany();
    expect(clientes).toHaveLength(1);
    expect(clientes[0]).toMatchObject({ canal: 'B2B', telefono: '5533334444', nombre: 'Luis C. Nuevo', totalPedidos: 2 });
    expect(clientes[0].ultimoPedidoAt.toISOString()).toBe('2026-09-30T18:00:00.000Z');
    expect(clientes[0].primerPedidoAt.toISOString()).toBe('2026-09-30T16:00:00.000Z');
  });
});

describe('B2B · creación pública, rechazos', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });

  async function sinEfectos() {
    await cederEventLoop();
    expect(await s.h.prisma.order.count({ where: { tipo: 'B2B' } })).toBe(0);
    expect(await s.h.prisma.orderItem.count({ where: { order: { tipo: 'B2B' } } })).toBe(0);
    expect(await s.h.prisma.entregaItem.count()).toBe(0);
    expect(await s.h.prisma.cliente.count()).toBe(0);
  }
  async function rechaza(extra: Record<string, unknown>, status: number, message: string | string[]) {
    const res = await postPublicoB2b(s.h, s.base.tenant.slug, bodyB2b(s.base, extra));
    expectError(res, status, message);
    await sinEfectos();
  }

  it('negocio inexistente: 404', async () => {
    expectError(await postPublicoB2b(s.h, 'no-existe', bodyB2b(s.base)), 404, 'Negocio no encontrado');
  });

  it('ventana de recepción cerrada: 409 con cuándo reabre', async () => {
    // Hoy es miércoles 10:00; la ventana abre jueves.
    await configurarB2b(s.h.prisma, s.base.tenant.id, {
      ventana: { aperturaDia: 'JUEVES', aperturaHora: '08:00', cierreDia: 'VIERNES', cierreHora: '18:00' },
    });
    await rechaza({}, 409, 'Este negocio no recibe pedidos en este momento — vuelve a abrir el jueves a las 08:00.');
  });

  it('dentro de la ventana se acepta', async () => {
    await configurarB2b(s.h.prisma, s.base.tenant.id, {
      ventana: { aperturaDia: 'MARTES', aperturaHora: '08:00', cierreDia: 'JUEVES', cierreHora: '18:00' },
    });
    expect((await postPublicoB2b(s.h, s.base.tenant.slug, bodyB2b(s.base))).status).toBe(201);
  });

  it('tenant en AL_INICIO: 409 (el flujo de pago con tarjeta no existe en este storefront)', async () => {
    await configurarB2b(s.h.prisma, s.base.tenant.id, { modoCobro: 'AL_INICIO' });
    await rechaza(
      {},
      409,
      'Este negocio requiere pago con tarjeta al confirmar el pedido — ese flujo aún no está disponible en este storefront. Contacta directamente al negocio.',
    );
  });

  describe('facturación', () => {
    it('OBLIGATORIO sin requiereFactura: 400', async () => {
      await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { facturacionModo: 'OBLIGATORIO' } });
      await rechaza({}, 400, 'Este negocio requiere factura para todos los pedidos');
    });

    it('requiereFactura con datos faltantes: 400 con los campos', async () => {
      await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { facturacionModo: 'OPCIONAL' } });
      await rechaza(
        { requiereFactura: true, facturaRfc: 'CLE010101AB1' },
        400,
        'Faltan datos de factura: facturaRazonSocial, facturaRegimenFiscal, facturaUsoCfdi, facturaCodigoPostal, facturaCorreo',
      );
    });
  });

  describe('semana e items', () => {
    it('semanaInicio que no es lunes: 400', async () => {
      await rechaza({ semanaInicio: '2026-10-06' }, 400, '"semanaInicio" debe ser un lunes — inicio de la semana del pedido');
    });

    it('semanaInicio con formato inválido: 400 de validación', async () => {
      await rechaza({ semanaInicio: 'mañana' }, 400, ['semanaInicio must be a valid ISO 8601 date string']);
    });

    it('items vacío: 400', async () => {
      await rechaza({ items: [] }, 400, ['items must contain at least 1 elements']);
    });

    it('item sin distribución: 400', async () => {
      await rechaza({ items: [{ productId: s.base.productoA.id, distribucion: [] }] }, 400, [
        'items.0.distribucion must contain at least 1 elements',
      ]);
    });

    it('cantidad negativa, día inválido, productId no UUID: 400 de validación', async () => {
      await rechaza({ items: [{ productId: s.base.productoA.id, distribucion: [{ dia: 'LUNES', cantidad: -1 }] }] }, 400, [
        'items.0.distribucion.0.cantidad must not be less than 0',
      ]);
      await rechaza({ items: [{ productId: s.base.productoA.id, distribucion: [{ dia: 'FUNDAY', cantidad: 1 }] }] }, 400, [
        'items.0.distribucion.0.dia must be one of the following values: LUNES, MARTES, MIERCOLES, JUEVES, VIERNES, SABADO, DOMINGO',
      ]);
      await rechaza({ items: [{ productId: 'x', distribucion: [{ dia: 'LUNES', cantidad: 1 }] }] }, 400, [
        'items.0.productId must be a UUID',
      ]);
    });

    it('cantidad no entera: 400', async () => {
      await rechaza({ items: [{ productId: s.base.productoA.id, distribucion: [{ dia: 'LUNES', cantidad: 1.5 }] }] }, 400, [
        'items.0.distribucion.0.cantidad must be an integer number',
      ]);
    });

    it('día repetido dentro de un producto: 400', async () => {
      await rechaza(
        {
          items: [
            {
              productId: s.base.productoA.id,
              distribucion: [
                { dia: 'LUNES', cantidad: 1 },
                { dia: 'LUNES', cantidad: 2 },
              ],
            },
          ],
        },
        400,
        'El día "LUNES" está repetido para "Café americano"',
      );
    });

    it('un producto con todas las cantidades en 0: 400', async () => {
      await rechaza({ items: [{ productId: s.base.productoA.id, distribucion: [{ dia: 'LUNES', cantidad: 0 }] }] }, 400, [
        '"Café americano" no tiene ninguna cantidad asignada en la semana',
      ].join(''));
    });

    it('producto de otro tenant: 404 (no confirma que existe)', async () => {
      const otro = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
      await rechaza(
        { items: [{ productId: otro.productoA.id, distribucion: [{ dia: 'LUNES', cantidad: 5 }] }] },
        404,
        'Uno o más productos no existen en este negocio',
      );
    });

    it('contacto: correo inválido y teléfono corto: 400 de validación', async () => {
      await rechaza({ contactoCorreo: 'no-es-correo' }, 400, ['contactoCorreo must be an email']);
      await rechaza({ contactoTelefono: '123' }, 400, ['contactoTelefono must be longer than or equal to 7 characters']);
    });
  });

  describe('código de descuento', () => {
    it('no existe: 404', async () => {
      await rechaza({ codigoDescuento: 'NOEXISTE' }, 404, 'El código de descuento no existe o no está activo');
    });

    it('inactivo: 404', async () => {
      await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'APAGADO', activo: false });
      await rechaza({ codigoDescuento: 'APAGADO' }, 404, 'El código de descuento no existe o no está activo');
    });

    it('vencido: 409 con la fecha', async () => {
      await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'VIEJO', fechaLimite: '2026-09-29' });
      await rechaza({ codigoDescuento: 'VIEJO' }, 409, 'El código de descuento ya no es válido — venció el 2026-09-29');
    });

    it('vigente hoy (fechaLimite = hoy): se acepta', async () => {
      await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'HOY', fechaLimite: '2026-09-30' });
      expect((await postPublicoB2b(s.h, s.base.tenant.slug, bodyB2b(s.base, { codigoDescuento: 'HOY' }))).status).toBe(201);
    });

    it('agotado (usosMaximos alcanzado, incluyendo pedidos cancelados): 409', async () => {
      await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'UNICO', usosMaximos: 1 });
      const primero = await postPublicoB2b(s.h, s.base.tenant.slug, bodyB2b(s.base, { codigoDescuento: 'UNICO' }));
      expect(primero.status).toBe(201);
      const conteo = await s.h.prisma.order.count({ where: { tipo: 'B2B' } });
      // cancelar el primero NO libera el cupo
      await s.h.prisma.order.update({ where: { id: primero.body.id }, data: { cancelado: true, canceladoAt: new Date() } });
      const res = await postPublicoB2b(s.h, s.base.tenant.slug, bodyB2b(s.base, { codigoDescuento: 'UNICO', contactoTelefono: '5500000009' }));
      expectError(res, 409, 'El código de descuento ya alcanzó su límite de usos');
      expect(await s.h.prisma.order.count({ where: { tipo: 'B2B' } })).toBe(conteo);
    });

    it('código de otro tenant: 404', async () => {
      const otro = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
      await seedCodigoDescuento(s.h.prisma, otro.tenant.id, { codigo: 'AJENO' });
      await rechaza({ codigoDescuento: 'AJENO' }, 404, 'El código de descuento no existe o no está activo');
    });
  });
});
