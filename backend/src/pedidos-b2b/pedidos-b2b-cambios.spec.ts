import {
  armarReferencia,
  calcularCambios,
  type LineaReferencia,
  type ReferenciaPedido,
} from './pedidos-b2b-cambios';

const l = (productId: string, cantidad: number): LineaReferencia => ({
  productId,
  nombreProducto: `P-${productId}`,
  cantidad,
});
const ref = (
  entregas: [string, LineaReferencia[]][],
  extra: Partial<ReferenciaPedido> = {},
): ReferenciaPedido => ({
  total: '100.00',
  notaCliente: null,
  entregas: entregas.map(([fecha, lineas]) => ({ fecha, lineas })),
  ...extra,
});

describe('armarReferencia', () => {
  it('toma solo las entregas vigentes, con sus líneas en el orden del pedido y el total a dos decimales', () => {
    const r = armarReferencia({
      total: 255.5,
      detalleB2b: { notaCliente: '  hola ' },
      items: [
        {
          id: 'i2',
          productId: 'b',
          nombreProducto: 'B',
          orden: 1,
          entregaItems: [{ entregaId: 'e1', cantidad: 1 }],
        },
        {
          id: 'i1',
          productId: 'a',
          nombreProducto: 'A',
          orden: 0,
          entregaItems: [
            { entregaId: 'e1', cantidad: 2 },
            { entregaId: 'e2', cantidad: 9 },
          ],
        },
      ],
      entregas: [
        { id: 'e2', fecha: new Date('2026-10-03'), estado: 'CANCELADA' },
        { id: 'e1', fecha: new Date('2026-10-02'), estado: 'PENDIENTE' },
      ],
    });
    expect(r).toEqual({
      total: '255.50',
      notaCliente: 'hola',
      entregas: [
        {
          fecha: '2026-10-02',
          lineas: [
            { productId: 'a', nombreProducto: 'A', cantidad: 2 },
            { productId: 'b', nombreProducto: 'B', cantidad: 1 },
          ],
        },
      ],
    });
  });
});

describe('calcularCambios', () => {
  const base = ref([
    ['2026-11-11', [l('a', 4), l('b', 2)]],
    ['2026-11-13', [l('c', 1)]],
  ]);

  it('igual a la referencia → sin diferencias', () => {
    expect(calcularCambios(base, structuredClone(base))).toMatchObject({
      sinDiferencias: true,
      soloPrecios: false,
      entregas: [],
      nota: null,
      total: null,
    });
  });

  it('cantidad, producto nuevo y producto eliminado, ordenados por fecha', () => {
    const actual = ref(
      [
        ['2026-11-11', [l('a', 6), l('b', 2), l('d', 5)]],
        ['2026-11-13', []],
      ],
      { total: '125.70' },
    );
    const c = calcularCambios(base, actual);
    expect(c.sinDiferencias).toBe(false);
    expect(c.total).toEqual({ antes: '100.00', despues: '125.70' });
    expect(c.entregas).toEqual([
      {
        tipo: 'MODIFICADA',
        fecha: '2026-11-11',
        piezas: 13,
        lineas: [
          {
            productId: 'a',
            nombreProducto: 'P-a',
            tipo: 'CAMBIO',
            antes: 4,
            despues: 6,
          },
          {
            productId: 'd',
            nombreProducto: 'P-d',
            tipo: 'NUEVO',
            antes: null,
            despues: 5,
          },
        ],
      },
      {
        tipo: 'MODIFICADA',
        fecha: '2026-11-13',
        piezas: 0,
        lineas: [
          {
            productId: 'c',
            nombreProducto: 'P-c',
            tipo: 'ELIMINADO',
            antes: 1,
            despues: null,
          },
        ],
      },
    ]);
  });

  it('entrega nueva y eliminada', () => {
    const actual = ref([
      ['2026-11-11', [l('a', 4), l('b', 2)]],
      ['2026-11-14', [l('z', 12)]],
    ]);
    const c = calcularCambios(base, actual);
    expect(c.entregas.map((e) => [e.tipo, e.fecha, e.piezas])).toEqual(
      [
        ['NUEVA', '2026-11-14', 12],
        ['ELIMINADA', '2026-11-13', 1],
      ].sort((x, y) => String(x[1]).localeCompare(String(y[1]))),
    );
  });

  it('eliminada + nueva con el mismo contenido → movida; con distinto contenido → no', () => {
    const movida = calcularCambios(
      base,
      ref([
        ['2026-11-11', [l('a', 4), l('b', 2)]],
        ['2026-11-15', [l('c', 1)]],
      ]),
    );
    expect(movida.entregas).toEqual([
      {
        tipo: 'MOVIDA',
        fecha: '2026-11-15',
        fechaAnterior: '2026-11-13',
        piezas: 1,
        lineas: [],
      },
    ]);
    const distinta = calcularCambios(
      base,
      ref([
        ['2026-11-11', [l('a', 4), l('b', 2)]],
        ['2026-11-15', [l('c', 2)]],
      ]),
    );
    expect(distinta.entregas.map((e) => e.tipo)).toEqual([
      'ELIMINADA',
      'NUEVA',
    ]);
  });

  it('cada eliminada se empareja con una sola nueva', () => {
    const dos = ref([
      ['2026-11-11', [l('a', 1)]],
      ['2026-11-12', [l('a', 1)]],
    ]);
    const c = calcularCambios(
      dos,
      ref([
        ['2026-11-15', [l('a', 1)]],
        ['2026-11-16', [l('a', 1)]],
      ]),
    );
    expect(c.entregas.map((e) => e.tipo)).toEqual(['MOVIDA', 'MOVIDA']);
    const uno = calcularCambios(dos, ref([['2026-11-15', [l('a', 1)]]]));
    expect(uno.entregas.map((e) => e.tipo).sort()).toEqual([
      'ELIMINADA',
      'MOVIDA',
    ]);
  });

  it('nota nueva, modificada y quitada (espacios y vacío cuentan como sin nota)', () => {
    const conNota = (n: string | null) =>
      ref(
        [
          ['2026-11-11', [l('a', 4), l('b', 2)]],
          ['2026-11-13', [l('c', 1)]],
        ],
        { notaCliente: n },
      );
    expect(calcularCambios(conNota(null), conNota('hola')).nota).toBe('NUEVA');
    expect(calcularCambios(conNota('hola'), conNota('adiós')).nota).toBe(
      'MODIFICADA',
    );
    expect(calcularCambios(conNota('hola'), conNota(null)).nota).toBe(
      'QUITADA',
    );
    expect(calcularCambios(conNota(null), conNota('  ')).sinDiferencias).toBe(
      true,
    );
  });

  it('solo cambió el total → soloPrecios, sin cambios de productos', () => {
    const c = calcularCambios(base, {
      ...structuredClone(base),
      total: '110.00',
    });
    expect(c).toMatchObject({
      soloPrecios: true,
      sinDiferencias: false,
      entregas: [],
      total: { antes: '100.00', despues: '110.00' },
    });
  });

  it('con cambios de cantidades y total distinto, soloPrecios es falso', () => {
    const c = calcularCambios(
      base,
      ref(
        [
          ['2026-11-11', [l('a', 5), l('b', 2)]],
          ['2026-11-13', [l('c', 1)]],
        ],
        { total: '110.00' },
      ),
    );
    expect(c.soloPrecios).toBe(false);
  });

  it('un producto sin productId se cruza por nombre', () => {
    const sin = (n: number) =>
      ref([
        ['2026-11-11', [{ productId: null, nombreProducto: 'X', cantidad: n }]],
      ]);
    expect(calcularCambios(sin(1), sin(1)).sinDiferencias).toBe(true);
    expect(calcularCambios(sin(1), sin(2)).entregas[0].lineas[0]).toMatchObject(
      { tipo: 'CAMBIO', antes: 1, despues: 2 },
    );
  });
});
