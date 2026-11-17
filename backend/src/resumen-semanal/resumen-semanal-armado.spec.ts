import ExcelJS from 'exceljs';
import { ResumenSemanalArmadoService } from './resumen-semanal-armado.service';

const item = (nombre: string, precio: string, cantidad: number) => ({
  cantidad,
  orderItem: { nombreProducto: nombre, precioUnitario: precio },
});

// Un pedido con 10% de descuento y dos entregas (lista 218.20 → 196.38).
const pedido = {
  folio: 'B-1',
  estadoPedido: 'COMPLETADO',
  estadoPago: 'PAGADO',
  cancelado: false,
  total: '196.38',
  descuentoTotal: '21.82',
  createdAt: new Date('2026-10-26T15:00:00.000Z'),
  cliente: { codigo: 'C-1' },
  detalleB2b: {
    negocioNombre: 'Café Sol',
    semanaInicio: new Date('2026-10-26T00:00:00.000Z'),
    subtotal: '218.20',
    descuentoPorcentajeAplicado: '10',
    pagadoAt: new Date('2026-10-30T15:00:00.000Z'),
    notaCliente: 'Sin nota',
  },
  entregas: [
    {
      estado: 'ENTREGADA',
      fecha: new Date('2026-10-27T00:00:00.000Z'),
      nota: 'Tocar timbre',
      estadoCambiadoAt: new Date('2026-10-27T18:00:00.000Z'),
      items: [item('Alfajor', '30.40', 3), item('Alfajor', '35.00', 2), item('Pan', '9.50', 4)],
    },
    {
      estado: 'NO_RECOGIDA',
      fecha: new Date('2026-10-29T00:00:00.000Z'),
      nota: null,
      estadoCambiadoAt: new Date('2026-10-29T18:00:00.000Z'),
      items: [item('Pan', '9.50', 2)],
    },
  ],
};

describe('ResumenSemanalArmadoService.armar: Excel adjunto al negocio', () => {
  const servicio = new ResumenSemanalArmadoService({
    order: { findMany: async () => [pedido] },
  } as any);
  const armar = async () => {
    const r = await servicio.armar('t1', 'Banetto', { inicio: '2026-10-26', fin: '2026-11-01' } as any);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load((r as any).adjunto.contenido);
    return { libro, r };
  };
  const enc = (h: ExcelJS.Worksheet) => (h.getRow(1).values as string[]).slice(1);

  it('sale en el formato agrupado de Históricos, con estados, y las tablas planas con todas las columnas de siempre', async () => {
    const { libro } = await armar();
    expect(libro.worksheets.map((w) => w.name)).toEqual(['Pedidos', 'Entregas', 'Datos pedidos', 'Datos entregas']);
    expect(enc(libro.getWorksheet('Pedidos')!)).toEqual([
      'Negocio / Producto', 'Semana (inicio)', 'Semana (fin)', 'Fecha de creación', 'Entregas totales',
      'Subtotal', 'Descuento', 'Total', 'Estado del pedido', 'Estado de pago',
    ]);
    expect(libro.getWorksheet('Pedidos')!.getRow(2).getCell(1).value).toBe('Café Sol · 10% de descuento');
    // Tablas planas = las columnas del resumen al negocio de siempre (las de Históricos).
    expect(enc(libro.getWorksheet('Datos pedidos')!)).toEqual([
      'Negocio', 'Semana (inicio)', 'Semana (fin)', 'Fecha de creación', 'Estado del pedido', 'Estado de pago', 'Fecha de pago',
      'Entregas totales', 'Entregadas', 'No recogidas', 'Canceladas', 'Subtotal', 'Descuento %', 'Descuento $', 'Total', 'Nota del cliente',
    ]);
    expect(enc(libro.getWorksheet('Datos entregas')!)).toEqual([
      'Negocio', 'Fecha de entrega', 'Día', 'Estado de la entrega', 'Piezas', 'Importe (antes de descuento)', 'Nota de la entrega',
    ]);
    const plana = libro.getWorksheet('Datos pedidos')!.getRow(2);
    expect([plana.getCell(5).value, plana.getCell(6).value, plana.getCell(15).value]).toEqual(['Completado', 'Pagado', 196.38]);
  });

  it('el cierre del pedido cuadra y el Total es el mismo de siempre', async () => {
    const { libro } = await armar();
    const h = libro.getWorksheet('Entregas')!;
    const t: string[] = [];
    h.eachRow((r) => t.push(`${r.getCell(1).value}|${r.getCell(5).value ?? ''}|${r.getCell(6).value ?? ''}`));
    expect(t.slice(-3)).toEqual(['Subtotal del pedido|218.2|', 'Descuento (10%)|21.82|', 'Total del pedido|196.38|']);
    expect(t.filter((x) => x.startsWith('Alfajor'))).toEqual(['Alfajor|91.2|', 'Alfajor|70|']);
    const estados: unknown[] = [];
    h.eachRow((r) => r.getCell(6).value && estados.push(r.getCell(6).value));
    expect(estados.slice(1)).toEqual(['Entregada', 'No recogida']);
  });
});
