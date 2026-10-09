import { configurarB2b, seedBase } from './db';
import { expectError, expectExacto } from './exacto';
import { cederEventLoop, usarSuite } from './helpers';
import {
  apiRol,
  cuerpoPanelB2b,
  diaEsperado,
  etiquetasB2b,
  itemB2bEsperado,
  pedidoB2bEsperado,
  SEMANA_ACTUAL,
  SEMANA_PASADA,
} from './b2b-helpers';

// 0b-1 · Áreas 1 y 2 · Creación de pedidos B2B. Fase 2: el POST público de mayoreo está cerrado (409, ver clientes-b2b-pedidos) y
// los casos de ítems, semana y snapshots se prueban por el panel (POST /pedidos-b2b con `clienteId`); los de factura, ventana de
// recepción, AL_INICIO y códigos de descuento del storefront anónimo desaparecen con él.
describe('B2B · creación de pedidos (panel): ítems, semana y snapshots', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const post = async (extra: Record<string, unknown> = {}) =>
    apiRol(s.h, s.base, 'DUENO').post(
      '/pedidos-b2b',
      await cuerpoPanelB2b(s.h, s.base, extra),
    );
  const exacto = (
    body: any,
    esperado: unknown,
    extra: Record<string, string> = {},
  ) => expectExacto(body, esperado, etiquetasB2b(s.base, body, extra));

  it('el campo semanaInicio se serializa como fecha-hora UTC a medianoche', async () => {
    const res = await post();
    expect(res.body.semanaInicio).toBe('2026-10-05T00:00:00.000Z');
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
        {
          productId: s.base.productoB.id,
          distribucion: [{ dia: 'VIERNES', cantidad: 4 }],
        },
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
        {
          productId: s.base.productoA.id,
          distribucion: [{ dia: 'LUNES', cantidad: 5 }],
        },
        {
          productId: s.base.productoA.id,
          distribucion: [{ dia: 'MARTES', cantidad: 5 }],
        },
      ],
    });
    expect(res.status).toBe(201);
    expectExacto(
      res.body,
      pedidoB2bEsperado({
        totalPiezas: 10,
        subtotal: '450',
        total: '450',
        items: [
          itemB2bEsperado(
            {
              cantidadTotal: 10,
              distribucion: [
                diaEsperado('LUNES', 5, 0),
                diaEsperado('MARTES', 5, 0),
              ],
            },
            0,
          ),
        ],
      }),
      etiquetasB2b(s.base, res.body),
    );
  });

  it('un pedido por debajo del mínimo de piezas SÍ se crea (el mínimo se valida al confirmar/pagar)', async () => {
    const res = await post({
      items: [
        {
          productId: s.base.productoB.id,
          distribucion: [{ dia: 'VIERNES', cantidad: 2 }],
        },
      ],
    });
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
    expect(
      (
        await s.h.prisma.detalleB2B.findUniqueOrThrow({
          where: { orderId: res.body.id },
        })
      ).minimoPiezasAplicado,
    ).toBe(25);
  });
});

describe('B2B · creación de pedidos (panel): rechazos de validación', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });

  async function sinEfectos() {
    await cederEventLoop();
    expect(await s.h.prisma.order.count({ where: { tipo: 'B2B' } })).toBe(0);
    expect(
      await s.h.prisma.orderItem.count({ where: { order: { tipo: 'B2B' } } }),
    ).toBe(0);
    expect(await s.h.prisma.entregaItem.count()).toBe(0);
  }
  async function rechaza(
    extra: Record<string, unknown>,
    status: number,
    message: string | string[],
  ) {
    const res = await apiRol(s.h, s.base, 'DUENO').post(
      '/pedidos-b2b',
      await cuerpoPanelB2b(s.h, s.base, extra),
    );
    expectError(res, status, message);
    await sinEfectos();
  }

  describe('semana e items', () => {
    it('semanaInicio que no es lunes: 400', async () => {
      await rechaza(
        { semanaInicio: '2026-10-06' },
        400,
        '"semanaInicio" debe ser un lunes — inicio de la semana del pedido',
      );
    });

    it('semanaInicio con formato inválido: 400 de validación', async () => {
      await rechaza({ semanaInicio: 'mañana' }, 400, [
        'semanaInicio must be a valid ISO 8601 date string',
      ]);
    });

    it('items vacío: 400', async () => {
      await rechaza({ items: [] }, 400, [
        'items must contain at least 1 elements',
      ]);
    });

    it('item sin distribución: 400', async () => {
      await rechaza(
        { items: [{ productId: s.base.productoA.id, distribucion: [] }] },
        400,
        ['items.0.distribucion must contain at least 1 elements'],
      );
    });

    it('cantidad negativa, día inválido, productId no UUID: 400 de validación', async () => {
      await rechaza(
        {
          items: [
            {
              productId: s.base.productoA.id,
              distribucion: [{ dia: 'LUNES', cantidad: -1 }],
            },
          ],
        },
        400,
        ['items.0.distribucion.0.cantidad must not be less than 0'],
      );
      await rechaza(
        {
          items: [
            {
              productId: s.base.productoA.id,
              distribucion: [{ dia: 'FUNDAY', cantidad: 1 }],
            },
          ],
        },
        400,
        [
          'items.0.distribucion.0.dia must be one of the following values: LUNES, MARTES, MIERCOLES, JUEVES, VIERNES, SABADO, DOMINGO',
        ],
      );
      await rechaza(
        {
          items: [
            { productId: 'x', distribucion: [{ dia: 'LUNES', cantidad: 1 }] },
          ],
        },
        400,
        ['items.0.productId must be a UUID'],
      );
    });

    it('cantidad no entera: 400', async () => {
      await rechaza(
        {
          items: [
            {
              productId: s.base.productoA.id,
              distribucion: [{ dia: 'LUNES', cantidad: 1.5 }],
            },
          ],
        },
        400,
        ['items.0.distribucion.0.cantidad must be an integer number'],
      );
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
      await rechaza(
        {
          items: [
            {
              productId: s.base.productoA.id,
              distribucion: [{ dia: 'LUNES', cantidad: 0 }],
            },
          ],
        },
        400,
        [
          '"Café americano" no tiene ninguna cantidad asignada en la semana',
        ].join(''),
      );
    });

    it('producto de otro tenant: 404 (no confirma que existe)', async () => {
      const otro = await seedBase(s.h.prisma, {
        slug: 'otro-mayoreo',
        tipoStorefront: 'RETAIL_B2B',
      });
      await rechaza(
        {
          items: [
            {
              productId: otro.productoA.id,
              distribucion: [{ dia: 'LUNES', cantidad: 5 }],
            },
          ],
        },
        404,
        'Uno o más productos no existen en este negocio',
      );
    });
  });
});
