import ExcelJS from 'exceljs';
import { libroPedidosAgrupado } from './pedidos-b2b-excel-agrupado';
import type { PedidoExport } from './pedidos-b2b-export';

const item = (nombre: string, precio: string, cantidad: number) => ({
  cantidad,
  orderItem: { nombreProducto: nombre, precioUnitario: precio },
});

const pedido = {
  folio: 'B-1',
  estadoPedido: 'COMPLETADO',
  estadoPago: 'PENDIENTE',
  cancelado: false,
  total: '218.20',
  descuentoTotal: '0',
  createdAt: new Date('2026-10-26T15:00:00.000Z'),
  cliente: { codigo: 'C-1' },
  detalleB2b: {
    negocioNombre: 'Café Sol',
    semanaInicio: new Date('2026-10-26T00:00:00.000Z'),
    subtotal: '218.20',
    descuentoPorcentajeAplicado: null,
    pagadoAt: null,
    notaCliente: null,
  },
  entregas: [
    {
      estado: 'ENTREGADA',
      fecha: new Date('2026-10-27T00:00:00.000Z'),
      nota: null,
      estadoCambiadoAt: new Date('2026-10-27T18:00:00.000Z'),
      items: [
        item('Alfajor', '30.40', 3),
        item('Alfajor', '35.00', 2),
        item('Pan', '9.50', 4),
      ],
    },
    {
      estado: 'PENDIENTE',
      fecha: new Date('2026-10-29T00:00:00.000Z'),
      nota: null,
      estadoCambiadoAt: new Date('2026-10-26T15:00:00.000Z'),
      items: [item('Pan', '9.50', 2)],
    },
  ],
} as unknown as PedidoExport;

const leer = async (pedidos: PedidoExport[] = [pedido]) => {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load((await libroPedidosAgrupado(pedidos)) as any);
  return libro;
};
const filas = (h: ExcelJS.Worksheet) => {
  const r: ExcelJS.Row[] = [];
  h.eachRow({ includeEmpty: true }, (row) => r.push(row));
  return r;
};
const variante = (extra: Record<string, unknown>, detalle: Record<string, unknown> = {}) =>
  ({
    ...pedido,
    ...extra,
    detalleB2b: { ...(pedido as any).detalleB2b, ...detalle },
  }) as unknown as PedidoExport;
// Lista del pedido de prueba: entrega 1 = 91.20 + 70 + 38 = 199.20 ; entrega 2 = 19.00 ; subtotal 218.20.
const CON_10 = variante(
  { total: '196.38', descuentoTotal: '21.82' },
  { descuentoPorcentajeAplicado: '10' },
);
const textoFila = (h: ExcelJS.Worksheet, columnas: number) =>
  filas(h).map((row) =>
    Array.from({ length: columnas }, (_, i) => String(row.getCell(i + 1).value ?? '')).join('|'),
  );

describe('libroPedidosAgrupado: hoja «Pedidos»', () => {
  it('encabezados: A libre para nombres, datos del pedido desde B, una sola columna «Descuento» y sin nota', async () => {
    const h = (await leer()).getWorksheet('Pedidos')!;
    expect((h.getRow(1).values as string[]).slice(1)).toEqual([
      'Negocio / Producto',
      'Semana (inicio)',
      'Semana (fin)',
      'Fecha de creación',
      'Entregas totales',
      'Subtotal',
      'Descuento',
      'Total',
    ]);
    const pedidoRow = filas(h)[2];
    expect(pedidoRow.getCell(1).value).toBeNull();
    expect(pedidoRow.getCell(5).value).toBe(2); // Entregas totales
    expect(pedidoRow.getCell(6).value).toBe(218.2); // Subtotal
    expect(pedidoRow.getCell(7).value).toBe(0); // Descuento ($)
    expect(pedidoRow.getCell(8).value).toBe(218.2); // Total
    expect(pedidoRow.getCell(7).numFmt).toBe(pedidoRow.getCell(8).numFmt);
    expect(textoFila(h, 9).join('\n')).not.toMatch(/Nota/);
  });

  it('detalle de productos en D–F: Producto | Unidades | Precio unitario | Monto; Unidades × Precio = Monto; subtotal bajo Monto', async () => {
    const h = (await leer()).getWorksheet('Pedidos')!;
    const rs = filas(h);
    const iSub = rs.findIndex((r) => r.getCell(1).value === 'Producto');
    expect([1, 4, 5, 6].map((c) => rs[iSub].getCell(c).value)).toEqual(['Producto', 'Unidades', 'Precio unitario', 'Monto']);
    const productos = rs.slice(iSub + 1, iSub + 5);
    expect(productos.map((r) => r.getCell(1).value)).toEqual(['Alfajor', 'Alfajor', 'Pan', 'Subtotal de productos']);
    for (const r of productos.slice(0, 3)) {
      expect(Number(r.getCell(4).value) * Number(r.getCell(5).value)).toBeCloseTo(Number(r.getCell(6).value), 9);
      expect(r.getCell(5).numFmt).toBe(r.getCell(6).numFmt);
    }
    // Alfajor a dos precios sigue en dos renglones; Pan se consolida entre entregas (6 × 9.50 = 57).
    expect(productos.map((r) => r.getCell(5).value)).toEqual([30.4, 35, 9.5, null]);
    expect(productos[2].getCell(4).value).toBe(6);
    expect(productos[3].getCell(6).value).toBe(91.2 + 70 + 57);
  });

  it('banda del negocio: sin descuento solo el nombre; con descuento, el % una vez junto al nombre', async () => {
    const sin = (await leer()).getWorksheet('Pedidos')!;
    expect(sin.getRow(2).getCell(1).value).toBe('Café Sol');
    const con = (await leer([CON_10])).getWorksheet('Pedidos')!;
    expect(con.getRow(2).getCell(1).value).toBe('Café Sol · 10% de descuento');
    expect(filas(con)[2].getCell(7).value).toBe(21.82); // Descuento $ del pedido, sin %
    expect(String(filas(con)[2].getCell(7).value)).not.toContain('%');
  });

  it('porcentajes distintos en un mismo negocio: se listan todos en la banda, de menor a mayor; un pedido sin descuento no suma', async () => {
    const p15 = variante({ folio: 'B-2', total: '185.47', descuentoTotal: '32.73' }, { descuentoPorcentajeAplicado: '15' });
    const p0 = variante({ folio: 'B-3' });
    const nombres = (pedidos: PedidoExport[]) =>
      leer(pedidos).then((l) => String(l.getWorksheet('Pedidos')!.getRow(2).getCell(1).value));
    expect(await nombres([CON_10, p15])).toBe('Café Sol · 10% y 15% de descuento');
    expect(await nombres([p15, CON_10, p0])).toBe('Café Sol · 10% y 15% de descuento');
    expect(await nombres([CON_10, variante({ folio: 'B-4', total: '196.38', descuentoTotal: '21.82' }, { descuentoPorcentajeAplicado: '10' })])).toBe(
      'Café Sol · 10% de descuento',
    );
    expect(await nombres([p0])).toBe('Café Sol');
  });

  it('descuento por monto fijo (sin %): la banda muestra el porcentaje efectivo', async () => {
    const fijo = variante({ total: '168.20', descuentoTotal: '50' }, { descuentoPorcentajeAplicado: null });
    expect(String((await leer([fijo])).getWorksheet('Pedidos')!.getRow(2).getCell(1).value)).toBe('Café Sol · 22.91% de descuento');
  });

  it('pedido cancelado conserva el sufijo «Cancelado» en su Total', async () => {
    const h = (await leer([variante({ cancelado: true })])).getWorksheet('Pedidos')!;
    expect(filas(h)[2].getCell(8).numFmt).toContain('Cancelado');
  });
});

describe('libroPedidosAgrupado: hoja «Entregas»', () => {
  it('columnas: Día / Producto, Fecha, Piezas / Unidades, Precio unitario, Importe / Monto; sin nota', async () => {
    const h = (await leer()).getWorksheet('Entregas')!;
    expect((h.getRow(1).values as string[]).slice(1)).toEqual([
      'Día / Producto',
      'Fecha de entrega',
      'Piezas / Unidades',
      'Precio unitario',
      'Importe / Monto (antes de descuento)',
    ]);
    const rs = filas(h).slice(1);
    const enc = rs.find((r) => r.getCell(1).value === 'Martes')!;
    expect(enc.getCell(3).value).toBe(9);
    expect(enc.getCell(4).value).toBeNull();
    expect(enc.getCell(5).value).toBe(91.2 + 70 + 38);
    const prods = rs.filter((r) => ['Alfajor', 'Pan'].includes(String(r.getCell(1).value)));
    expect(prods).toHaveLength(4);
    for (const r of prods) {
      expect(Number(r.getCell(3).value) * Number(r.getCell(4).value)).toBeCloseTo(Number(r.getCell(5).value), 9);
      expect(r.getCell(4).numFmt).toBe(r.getCell(5).numFmt);
    }
    expect(textoFila(h, 6).join('\n')).not.toMatch(/Nota/);
  });

  it('el cierre del pedido son SIEMPRE tres renglones; sin descuento dice «Descuento (0%)» con $0.00', async () => {
    const t = textoFila((await leer()).getWorksheet('Entregas')!, 5).slice(-3);
    expect(t).toEqual(['Subtotal del pedido||||218.2', 'Descuento (0%)||||0', 'Total del pedido||||218.2']);
    // Sin descuento, las entregas NO llevan bloque propio.
    expect(textoFila((await leer()).getWorksheet('Entregas')!, 5).join('\n')).not.toContain('Total de la entrega');
  });

  it('con 10%: bloque por entrega y cierre del pedido; Σ descuentos de entregas = descuento del pedido y Σ totales = Total', async () => {
    const t = textoFila((await leer([CON_10])).getWorksheet('Entregas')!, 5);
    const i = t.findIndex((x) => x.startsWith('Martes'));
    expect(t.slice(i + 4, i + 7)).toEqual(['Subtotal||||199.2', 'Descuento (10%)||||19.92', 'Total de la entrega||||179.28']);
    expect(t.slice(-3)).toEqual(['Subtotal del pedido||||218.2', 'Descuento (10%)||||21.82', 'Total del pedido||||196.38']);
    const valores = (prefijo: string) =>
      t.filter((x) => x.startsWith(prefijo)).map((x) => Math.round(Number(x.split('|')[4]) * 100));
    const descuentos = valores('Descuento');
    expect(descuentos[0] + descuentos[1]).toBe(descuentos[2]);
    const totales = valores('Total de la entrega');
    expect(totales[0] + totales[1]).toBe(Math.round(196.38 * 100));
  });

  it('descuento por monto fijo: el cierre muestra el porcentaje efectivo', async () => {
    const fijo = variante({ total: '168.20', descuentoTotal: '50' }, { descuentoPorcentajeAplicado: null });
    expect(textoFila((await leer([fijo])).getWorksheet('Entregas')!, 5).join('\n')).toContain('Descuento (22.91%)');
  });

  it('pedido cancelado con entregas cerradas: el cierre lo marca «(cancelado)»; una entrega cancelada no sale', async () => {
    const p = {
      ...pedido,
      cancelado: true,
      entregas: [(pedido as any).entregas[0], { ...(pedido as any).entregas[1], estado: 'CANCELADA' }],
    } as unknown as PedidoExport;
    const t = textoFila((await leer([p])).getWorksheet('Entregas')!, 5);
    expect(t[t.length - 1].split('|')[0]).toBe('Total del pedido (cancelado)');
    expect(t.filter((x) => x.startsWith('Jueves'))).toHaveLength(0);
  });

  it('pedido sin entregas vivas: no genera cierre', async () => {
    const p = {
      ...pedido,
      cancelado: true,
      total: '0',
      entregas: (pedido as any).entregas.map((e: any) => ({ ...e, estado: 'CANCELADA' })),
    } as unknown as PedidoExport;
    expect(textoFila((await leer([p])).getWorksheet('Entregas')!, 5).join('\n')).not.toMatch(/Total del pedido/);
  });
});

describe('libroPedidosAgrupado: bordes y encabezados', () => {
  const columnasDe: Record<string, number> = { Pedidos: 8, Entregas: 5 };
  const firma = (c: ExcelJS.Cell) =>
    JSON.stringify({
      b: c.border && Object.keys(c.border).length > 0 ? c.border : null, // sin borde = {} o nulo
      f: (c.fill as any)?.fgColor?.argb ?? null,
    });

  it.each(['Pedidos', 'Entregas'])('«%s»: cada renglón lleva el mismo borde y relleno en todo su ancho, sin líneas verticales', async (nombre) => {
    const h = (await leer([CON_10])).getWorksheet(nombre)!;
    const n = columnasDe[nombre];
    h.eachRow({ includeEmpty: false }, (row) => {
      const base = firma(row.getCell(1));
      for (let c = 1; c <= n; c++) {
        const cell = row.getCell(c);
        expect(firma(cell)).toBe(base);
        expect((cell.border as any)?.left).toBeUndefined();
        expect((cell.border as any)?.right).toBeUndefined();
      }
    });
    // Nada de celdas combinadas (pierden bordes en algunas celdas).
    expect(Object.keys((h as any)._merges ?? {})).toHaveLength(0);
  });

  it.each(['Pedidos', 'Entregas'])('«%s»: encabezados con ajuste de texto y altura para dos líneas, para que no se corten', async (nombre) => {
    const h = (await leer()).getWorksheet(nombre)!;
    const fila = h.getRow(1);
    expect(fila.height).toBeGreaterThanOrEqual(30);
    for (let c = 1; c <= columnasDe[nombre]; c++) {
      expect(fila.getCell(c).alignment?.wrapText).toBe(true);
      // Una línea cabe en el ancho o, si no, hay dos líneas de altura: con 34 pt caben dos.
      const largo = String(fila.getCell(c).value).length;
      expect(largo <= (h.getColumn(c).width ?? 10) * 2).toBe(true);
    }
  });
});

describe('libroPedidosAgrupado: pestañas planas', () => {
  it('no cambian: «Datos pedidos» conserva Descuento % y Descuento $ y la nota; «Datos entregas» su nota', async () => {
    const libro = await leer();
    const dp = (libro.getWorksheet('Datos pedidos')!.getRow(1).values as string[]).slice(1);
    expect(dp).toEqual(expect.arrayContaining(['Descuento %', 'Descuento $', 'Nota del cliente']));
    expect(dp).not.toContain('Precio unitario');
    const de = (libro.getWorksheet('Datos entregas')!.getRow(1).values as string[]).slice(1);
    expect(de).toContain('Nota de la entrega');
    expect(de).not.toContain('Precio unitario');
  });
});
