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

const leer = async () => {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load((await libroPedidosAgrupado([pedido])) as any);
  return libro;
};
const filas = (h: ExcelJS.Worksheet) => {
  const r: ExcelJS.Row[] = [];
  h.eachRow({ includeEmpty: true }, (row) => r.push(row));
  return r;
};

describe('libroPedidosAgrupado: Precio unitario', () => {
  it('«Pedidos»: Producto | Unidades | Precio unitario | Monto, Unidades × Precio = Monto, subtotal bajo Monto', async () => {
    const h = (await leer()).getWorksheet('Pedidos')!;
    const rs = filas(h);
    const iSub = rs.findIndex((r) => r.getCell(1).value === 'Producto');
    expect([1, 2, 3, 4].map((c) => rs[iSub].getCell(c).value)).toEqual([
      'Producto', 'Unidades', 'Precio unitario', 'Monto',
    ]);
    const productos = rs.slice(iSub + 1, iSub + 5);
    expect(productos.map((r) => r.getCell(1).value)).toEqual(['Alfajor', 'Alfajor', 'Pan', 'Subtotal de productos']);
    for (const r of productos.slice(0, 3)) {
      expect(Number(r.getCell(2).value) * Number(r.getCell(3).value)).toBeCloseTo(Number(r.getCell(4).value), 9);
      expect(r.getCell(3).numFmt).toBe(r.getCell(4).numFmt);
    }
    // Alfajor a dos precios sigue en dos renglones; Pan se consolida entre entregas (6 × 9.50 = 57).
    expect(productos.map((r) => r.getCell(3).value)).toEqual([30.4, 35, 9.5, null]);
    expect(productos[2].getCell(2).value).toBe(6);
    const sub = productos[3];
    expect(sub.getCell(3).value).toBeNull();
    expect(sub.getCell(4).value).toBe(91.2 + 70 + 57);
    for (let c = 1; c <= 4; c++) expect(sub.getCell(c).border?.top).toBeDefined();
  });

  it('«Entregas»: columna nueva en D, Importe en E y Nota en F; renglones no-producto sin precio', async () => {
    const h = (await leer()).getWorksheet('Entregas')!;
    expect((h.getRow(1).values as string[]).slice(1)).toEqual([
      'Día / Producto',
      'Fecha de entrega',
      'Piezas / Unidades',
      'Precio unitario',
      'Importe / Monto (antes de descuento)',
      'Nota de la entrega',
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
    // La banda del negocio abarca las 6 columnas.
    expect(h.getRow(2).getCell(6).isMerged).toBe(true);
  });

  it('las pestañas planas no cambian', async () => {
    const libro = await leer();
    expect((libro.getWorksheet('Datos entregas')!.getRow(1).values as string[]).slice(1)).not.toContain('Precio unitario');
    expect((libro.getWorksheet('Datos pedidos')!.getRow(1).values as string[]).slice(1)).not.toContain('Precio unitario');
  });
});

describe('libroPedidosAgrupado: bloque Subtotal / Descuento / Total en «Entregas»', () => {
  const conDescuento = (extra: Record<string, unknown>) => ({ ...pedido, ...extra }) as unknown as PedidoExport;
  const texto = (h: ExcelJS.Worksheet) => {
    const r: string[] = [];
    h.eachRow({ includeEmpty: true }, (row) =>
      r.push([1, 2, 3, 4, 5, 6].map((c) => String(row.getCell(c).value ?? '')).join('|')),
    );
    return r;
  };
  const libro = async (p: PedidoExport) => {
    const l = new ExcelJS.Workbook();
    await l.xlsx.load((await libroPedidosAgrupado([p])) as any);
    return l;
  };

  // Lista del pedido de prueba: entrega 1 = 91.20 + 70 + 38 = 199.20 ; entrega 2 = 19.00 ; subtotal 218.20.
  it('con 10%: bloque por entrega y por pedido; Σ descuentos = descuento del pedido y Σ totales = Total (sin cambiarlo)', async () => {
    const p = conDescuento({
      total: '196.38',
      descuentoTotal: '21.82',
      detalleB2b: { ...(pedido as any).detalleB2b, subtotal: '218.20', descuentoPorcentajeAplicado: '10' },
    });
    const h = (await libro(p)).getWorksheet('Entregas')!;
    const t = texto(h);
    const i = t.findIndex((x) => x.startsWith('Martes'));
    expect(t.slice(i + 4, i + 7).map((x) => x.split('|')[0] + '|' + x.split('|')[4])).toEqual([
      'Subtotal|199.2',
      'Descuento (10%)|19.92',
      'Total de la entrega|179.28',
    ]);
    expect(t.slice(-3).map((x) => x.split('|')[0] + '|' + x.split('|')[4])).toEqual([
      'Subtotal del pedido|218.2',
      'Descuento (10%)|21.82',
      'Total del pedido|196.38',
    ]);
    const descuentos = t.filter((x) => x.startsWith('Descuento')).map((x) => Number(x.split('|')[4]));
    // dos entregas (19.92 + 1.90) + el del pedido
    expect(Math.round((descuentos[0] + descuentos[1]) * 100)).toBe(2182);
  });

  it('sin descuento: solo «Total del pedido», sin Subtotal ni Descuento', async () => {
    const t = texto((await libro(pedido)).getWorksheet('Entregas')!);
    expect(t.join('\n')).not.toMatch(/Subtotal|Descuento/);
    expect(t[t.length - 1].split('|')[0]).toBe('Total del pedido');
  });

  it('descuento por monto fijo: muestra el porcentaje efectivo', async () => {
    const p = conDescuento({
      total: '168.20',
      descuentoTotal: '50',
      detalleB2b: { ...(pedido as any).detalleB2b, subtotal: '218.20', descuentoPorcentajeAplicado: null },
    });
    const t = texto((await libro(p)).getWorksheet('Entregas')!);
    expect(t.join('\n')).toContain('Descuento (22.91%)');
  });

  it('pedido cancelado con entregas cerradas: el cierre lo marca «(cancelado)» y conserva su Total; una entrega cancelada no sale', async () => {
    const p = {
      ...pedido,
      cancelado: true,
      entregas: [
        (pedido as any).entregas[0],
        { ...(pedido as any).entregas[1], estado: 'CANCELADA' },
      ],
    } as unknown as PedidoExport;
    const t = texto((await libro(p)).getWorksheet('Entregas')!);
    expect(t[t.length - 1].split('|')[0]).toBe('Total del pedido (cancelado)');
    expect(t.filter((x) => x.startsWith('Jueves'))).toHaveLength(0);
  });

  it('pedido sin entregas vivas: no genera bloque', async () => {
    const p = {
      ...pedido,
      cancelado: true,
      total: '0',
      entregas: (pedido as any).entregas.map((e: any) => ({ ...e, estado: 'CANCELADA' })),
    } as unknown as PedidoExport;
    const t = texto((await libro(p)).getWorksheet('Entregas')!);
    expect(t.join('\n')).not.toMatch(/Total del pedido/);
  });
});
