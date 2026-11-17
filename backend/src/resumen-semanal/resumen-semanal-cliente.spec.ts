import {
  construirCorreoCliente,
  inicioVentanaDeEnvio,
} from './resumen-semanal-cliente';
import { calcularTotales } from './resumen-semanal';
import type { FilaPedidoExcel } from '../pedidos-b2b/pedidos-b2b-excel';
import ExcelJS from 'exceljs';
import {
  libroResumenCliente,
  repartirTotalEnLineas,
  type LineaEntregaCliente,
} from './resumen-semanal-cliente-datos';
import { resolverResumenSemanal } from '../clientes-b2b/clientes-b2b.service';

const SEMANA = { inicio: '2026-10-26', fin: '2026-11-01' };
const fila = (extra: Partial<FilaPedidoExcel> = {}): FilaPedidoExcel => ({
  folio: 'B-1',
  clienteCodigo: 'banetto-cafe',
  negocioNombre: 'Café Ñandú',
  semanaInicio: new Date('2026-10-26T00:00:00.000Z'),
  notaCliente: null,
  createdAt: new Date('2026-10-20T16:00:00.000Z'),
  estado: 'PENDIENTE_CONFIRMACION',
  cancelado: false,
  estadoPago: 'PAGADO',
  pagadoAt: new Date('2026-10-21T16:00:00.000Z'),
  estadosEntregas: ['PENDIENTE'],
  totalPiezas: 10,
  subtotal: 120,
  descuentoPorcentaje: 10,
  descuentoTotal: 12,
  total: 108,
  ...extra,
});
const linea = (extra: Partial<LineaEntregaCliente> = {}): LineaEntregaCliente => ({
  folio: 'B-1',
  entregaId: 'e1',
  fecha: new Date('2026-10-27T00:00:00.000Z'),
  producto: 'Concha',
  unidades: 10,
  precio: 12,
  montoLista: 120,
  monto: 108,
  nota: null,
  ...extra,
});
const armar = (filas: FilaPedidoExcel[], lineas: LineaEntregaCliente[]) =>
  construirCorreoCliente('Banetto', 'Café Ñandú', SEMANA, calcularTotales(filas), filas, lineas);

// CAMBIO A PROPÓSITO (contenido del correo al cliente, tras revisar el correo real en staging): resumen en una línea, sin recuadro
// «Por revisar», sin estados de pedido ni de entrega (solo «Cancelado»), pie nuevo y sin la marca de Aelika.
describe('construirCorreoCliente', () => {
  it('asunto, encabezado y pie exacto con el nombre del negocio; sin la palabra Aelika', () => {
    const c = armar([fila()], [linea()]);
    expect(c.asunto).toBe('Tus pedidos con Banetto: 26 de octubre al 1 de noviembre');
    expect(c.html).toContain('Resumen semanal de tus pedidos con Banetto');
    const pie = 'Este es un mensaje automático. Para cualquier aclaración, comunícate con alguien del equipo de Banetto.';
    expect(c.texto).toContain(pie);
    expect(c.html).toContain(pie);
    for (const t of [c.texto, c.html, c.asunto]) expect(t).not.toMatch(/aelika/i);
  });

  it('resumen en una línea: pedidos y total (sin desglose por estado, piezas ni cancelados)', () => {
    const cancelado = fila({ folio: 'B-2', cancelado: true, estadosEntregas: ['CANCELADA'], total: 50 });
    const c = armar([fila(), cancelado], [linea()]);
    expect(c.texto).toContain('Pedidos: 1 · Total: $108.00');
    expect(c.html).toContain('Pedidos: 1 · Total: $108.00');
    for (const t of [c.texto, c.html]) {
      expect(t).not.toMatch(/Por confirmar|Confirmados|En proceso|Completados|Cancelados \(no suman\)|Por revisar|POR REVISAR/);
    }
  });

  it('sin estados de pedido ni de entrega; cada pedido muestra folio, piezas e importe y sus entregas día, piezas e importe', () => {
    const c = armar([fila()], [linea()]);
    for (const t of [c.texto, c.html]) {
      expect(t).not.toMatch(/Por confirmar|Confirmado|Pendiente|Atrasada|Entregada|No recogida|En proceso|Completado/);
    }
    expect(c.texto).toContain('Pedido B-1 · 10 piezas · $108.00');
    expect(c.texto).toContain('  - martes 27 de octubre · 10 piezas · $108.00');
  });

  it('NO menciona pago, cobranza ni descuento, y los montos son netos', () => {
    const c = armar([fila()], [linea()]);
    for (const t of [c.texto, c.html, c.asunto]) {
      expect(t).not.toMatch(/pago|pagad|cobranza|descuento|pendiente de/i);
    }
    expect(c.texto).not.toContain('$120.00');
    expect(c.texto).not.toContain('$12.00');
  });

  it('un pedido cancelado dice solo «Cancelado» y no suma; si es lo único, el aviso se conserva con totales en cero', () => {
    const cancelado = fila({ folio: 'B-2', cancelado: true, estadosEntregas: ['CANCELADA'], total: 50 });
    const mixto = armar([fila(), cancelado], [linea()]);
    expect(mixto.texto).toContain('Pedido B-2 · Cancelado');
    expect(mixto.texto).not.toContain('$50.00');
    const solo = armar([cancelado], []);
    expect(solo.texto).toContain('Todos tus pedidos de esta semana (1) están cancelados');
    expect(solo.texto).toContain('Pedidos: 0 · Total: $0.00');
  });

  it('dos entregas del mismo pedido se muestran por separado con la suma de sus productos', () => {
    const c = armar(
      [fila({ totalPiezas: 7, total: 100 })],
      [
        linea({ entregaId: 'e1', unidades: 3, monto: 30.5 }),
        linea({ entregaId: 'e1', producto: 'Pan', unidades: 1, monto: 19.5 }),
        linea({ entregaId: 'e2', fecha: new Date('2026-10-29T00:00:00.000Z'), unidades: 3, monto: 50 }),
      ],
    );
    expect(c.texto).toContain('  - martes 27 de octubre · 4 piezas · $50.00');
    expect(c.texto).toContain('  - jueves 29 de octubre · 3 piezas · $50.00');
  });

  it('escapa HTML y conserva acentos y ñ', () => {
    const c = construirCorreoCliente(
      'Panadería <Ñ> & Co',
      'Cliente "Ñ"',
      SEMANA,
      calcularTotales([fila()]),
      [fila()],
      [linea()],
    );
    expect(c.html).toContain('Panadería &lt;Ñ&gt; &amp; Co');
    expect(c.html).toContain('Cliente &quot;Ñ&quot;');
    expect(c.asunto).toBe('Tus pedidos con Panadería <Ñ> & Co: 26 de octubre al 1 de noviembre');
  });
});

describe('repartirTotalEnLineas', () => {
  it('la suma es EXACTAMENTE el total y cada línea queda en centavos enteros', () => {
    // 3 líneas iguales de $10.00 con total $10.00: 3.33 + 3.33 + 3.34 (el centavo sobrante a la primera de mayor residuo).
    const r = repartirTotalEnLineas(1000, [1000, 1000, 1000]);
    expect(r.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(r).toEqual([334, 333, 333]);
  });
  it('con descuento: proporcional al importe de lista y exacto', () => {
    // Lista 120.00 (80 + 40), total 108.00 → 72.00 y 36.00.
    expect(repartirTotalEnLineas(10800, [8000, 4000])).toEqual([7200, 3600]);
  });
  it('sin importe de lista o sin total, todo en cero', () => {
    expect(repartirTotalEnLineas(500, [0, 0])).toEqual([0, 0]);
    expect(repartirTotalEnLineas(0, [100, 200])).toEqual([0, 0]);
  });
  it('siempre suma el total aunque haya muchos residuos', () => {
    const brutos = [333, 777, 1234, 5, 9999, 1];
    for (const total of [1, 99, 12345, 20349]) {
      expect(repartirTotalEnLineas(total, brutos).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
});

describe('inicioVentanaDeEnvio', () => {
  it('es el lunes siguiente a la semana a las 10:00 CDMX (16:00 UTC)', () => {
    expect(inicioVentanaDeEnvio(SEMANA).toISOString()).toBe('2026-11-02T16:00:00.000Z');
  });
});

describe('resolverResumenSemanal (ficha del cliente)', () => {
  const apagado = { activo: false, correo: null as string | null };
  it('sin campos no cambia nada', () => {
    expect(resolverResumenSemanal(apagado, {})).toBeNull();
  });
  it('encender sin correo da 400; con correo normaliza y marca la activación', () => {
    expect(() => resolverResumenSemanal(apagado, { resumenSemanalActivo: true })).toThrow(
      'Captura el correo',
    );
    const r = resolverResumenSemanal(apagado, {
      resumenSemanalActivo: true,
      resumenSemanalCorreo: ' Compras@Cafe.COM ',
    });
    expect(r).toMatchObject({ activo: true, correo: 'compras@cafe.com' });
    expect(r!.activadoAt).toBeInstanceOf(Date);
  });
  it('correo inválido da 400', () => {
    expect(() =>
      resolverResumenSemanal(apagado, { resumenSemanalCorreo: 'no-es-correo' }),
    ).toThrow('no es una dirección de correo válida');
  });
  it('borrar el correo con el envío encendido lo apaga; ya encendido, editar el correo no renueva la activación', () => {
    const encendido = { activo: true, correo: 'a@b.com' };
    expect(resolverResumenSemanal(encendido, { resumenSemanalCorreo: '' })).toStrictEqual({
      activo: false,
      correo: null,
    });
    const r = resolverResumenSemanal(encendido, { resumenSemanalCorreo: 'c@d.com' });
    expect(r).toStrictEqual({ activo: true, correo: 'c@d.com' });
  });
  it('encender y borrar el correo a la vez da 400', () => {
    expect(() =>
      resolverResumenSemanal(apagado, { resumenSemanalActivo: true, resumenSemanalCorreo: null }),
    ).toThrow('Captura el correo');
  });
});

// CAMBIO A PROPÓSITO (formato del Excel al cliente): hoja «Pedidos» con detalle de entregas por pedido y hoja «Entregas» organizada
// por entrega (encabezado con día y fecha, piezas e importe, nota una sola vez, productos debajo y total al final).
describe('libroResumenCliente', () => {
  const leer = async (filas: FilaPedidoExcel[], lineas: LineaEntregaCliente[]) => {
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load((await libroResumenCliente(filas, lineas)) as any);
    return libro;
  };
  const texto = (h: ExcelJS.Worksheet) => {
    const r: string[] = [];
    h.eachRow({ includeEmpty: true }, (row) =>
      r.push(
        [1, 2, 3, 4]
          .map((c) => {
            const cell = row.getCell(c);
            return cell.isMerged && cell.master !== cell ? '' : String(cell.value ?? '');
          })
          .join('|'),
      ),
    );
    return r;
  };

  it('Pedidos: detalle de entregas (una por línea, por fecha) y Total; cancelado dice «Cancelado» en Total', async () => {
    const lineas = [
      linea({ entregaId: 'e2', fecha: new Date('2026-10-29T00:00:00.000Z'), unidades: 3, monto: 50 }),
      linea({ entregaId: 'e1', unidades: 7, monto: 58 }),
    ];
    const libro = await leer([fila(), fila({ folio: 'B-2', cancelado: true, total: 50 })], lineas);
    const h = libro.getWorksheet('Pedidos')!;
    expect((h.getRow(1).values as string[]).slice(1)).toEqual([
      'Negocio', 'Semana (inicio)', 'Semana (fin)', 'Fecha de creación', 'Entregas totales', 'Detalle de entregas', 'Total', 'Nota del cliente',
    ]);
    expect(h.getRow(2).getCell(6).value).toBe('martes 27 de octubre · 7 piezas · $58.00\njueves 29 de octubre · 3 piezas · $50.00');
    expect(h.getRow(3).getCell(7).value).toBe('Cancelado');
    expect(h.getRow(3).getCell(6).value).toBeNull();
    expect(h.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(h.pageSetup.orientation).toBe('landscape');
  });

  // Línea con precio de lista: el monto de lista es unidades × precio; `monto` (neto) solo lo usa el cuerpo del correo.
  const lista = (extra: Partial<LineaEntregaCliente> & { unidades: number; precio: number }) =>
    linea({ montoLista: Math.round(extra.unidades * extra.precio * 100) / 100, monto: 0, ...extra });
  const sinDescuento = (total: number) => fila({ subtotal: total, descuentoPorcentaje: 0, descuentoTotal: 0, total });

  it('Entregas sin descuento: productos a precio de lista, encabezado con el monto, nota una vez y solo «Total del pedido»', async () => {
    const lineas = [
      lista({ entregaId: 'e1', producto: 'Pan', unidades: 2, precio: 10, nota: 'Dejar en bodega' }),
      lista({ entregaId: 'e1', producto: 'Concha', unidades: 5, precio: 8, nota: 'Dejar en bodega' }),
      lista({ entregaId: 'e2', fecha: new Date('2026-10-29T00:00:00.000Z'), producto: 'Bolillo', unidades: 2, precio: 5 }),
    ];
    const h = (await leer([sinDescuento(70)], lineas)).getWorksheet('Entregas')!;
    expect(texto(h)).toEqual([
      'Entrega / Producto|Unidades|Precio unitario|Monto',
      'martes 27 de octubre|7||60',
      'Nota: Dejar en bodega|||',
      'Concha|5|8|40',
      'Pan|2|10|20',
      '|||',
      'jueves 29 de octubre|2||10',
      'Bolillo|2|5|10',
      '|||',
      'Total del pedido|9||70',
    ]);
    expect(texto(h).join('\n').match(/Dejar en bodega/g)).toHaveLength(1);
    expect(texto(h).join('\n')).not.toMatch(/Subtotal|Descuento/);
  });

  it('Entregas con descuento: bloque por entrega y por pedido, a precio de lista; Σ descuentos y Σ totales cuadran con el pedido', async () => {
    const lineas = [
      lista({ entregaId: 'e1', producto: 'Concha', unidades: 3, precio: 10 }),
      lista({ entregaId: 'e1', producto: 'Pan', unidades: 1, precio: 20 }),
      lista({ entregaId: 'e2', fecha: new Date('2026-10-29T00:00:00.000Z'), producto: 'Bolillo', unidades: 7, precio: 10 }),
    ];
    const h = (await leer([fila()], lineas)).getWorksheet('Entregas')!;
    expect(texto(h)).toEqual([
      'Entrega / Producto|Unidades|Precio unitario|Monto',
      'martes 27 de octubre|4||50',
      'Concha|3|10|30',
      'Pan|1|20|20',
      'Subtotal|||50',
      'Descuento (10%)|||5',
      'Total de la entrega|||45',
      '|||',
      'jueves 29 de octubre|7||70',
      'Bolillo|7|10|70',
      'Subtotal|||70',
      'Descuento (10%)|||7',
      'Total de la entrega|||63',
      '|||',
      'Subtotal del pedido|||120',
      'Descuento (10%)|||12',
      'Total del pedido|11||108',
    ]);
    // Unidades × Precio = Monto en cada renglón de producto y formato de moneda igual.
    h.eachRow((r) => {
      if (['Concha', 'Pan', 'Bolillo'].includes(String(r.getCell(1).value))) {
        expect(Number(r.getCell(2).value) * Number(r.getCell(3).value)).toBeCloseTo(Number(r.getCell(4).value), 9);
        expect(r.getCell(3).numFmt).toBe(r.getCell(4).numFmt);
      }
    });
  });

  it('el mismo producto con precios distintos sigue en renglones separados, cada uno a su precio de lista', async () => {
    const lineas = [
      lista({ entregaId: 'e1', producto: 'Alfajor', unidades: 3, precio: 30.4 }),
      lista({ entregaId: 'e1', producto: 'Alfajor', unidades: 2, precio: 35 }),
    ];
    const h = (await leer([sinDescuento(161.2)], lineas)).getWorksheet('Entregas')!;
    expect(texto(h).slice(2, 4)).toEqual(['Alfajor|3|30.4|91.2', 'Alfajor|2|35|70']);
  });

  it('el centavo del reparto cuadra: tres entregas iguales, descuento $10 → 3.33 + 3.33 + 3.34, totales que suman el del pedido', async () => {
    const f = fila({ subtotal: 30, descuentoPorcentaje: 0, descuentoTotal: 10, total: 20 });
    const lineas = ['e1', 'e2', 'e3'].map((id, i) =>
      lista({ entregaId: id, fecha: new Date(`2026-10-${27 + i}T00:00:00.000Z`), unidades: 1, precio: 10 }),
    );
    const h = (await leer([f], lineas)).getWorksheet('Entregas')!;
    const desc: number[] = [];
    const tot: number[] = [];
    h.eachRow((r) => {
      const et = String(r.getCell(1).value);
      if (et.startsWith('Descuento') && desc.length < 3) desc.push(Number(r.getCell(4).value));
      if (et === 'Total de la entrega') tot.push(Number(r.getCell(4).value));
    });
    expect(Math.round(desc.reduce((a, b) => a + b, 0) * 100)).toBe(1000);
    expect(Math.round(tot.reduce((a, b) => a + b, 0) * 100)).toBe(2000);
    // Descuento por monto fijo (sin %): se muestra el porcentaje efectivo, 10 / 30 = 33.33%.
    expect(texto(h).join('\n')).toContain('Descuento (33.33%)');
  });

  it('una sola entrega con una sola línea no rompe el formato', async () => {
    const h = (await leer([fila()], [lista({ unidades: 10, precio: 12 })])).getWorksheet('Entregas')!;
    expect(texto(h)).toEqual([
      'Entrega / Producto|Unidades|Precio unitario|Monto',
      'martes 27 de octubre|10||120',
      'Concha|10|12|120',
      'Subtotal|||120',
      'Descuento (10%)|||12',
      'Total de la entrega|||108',
      '|||',
      'Subtotal del pedido|||120',
      'Descuento (10%)|||12',
      'Total del pedido|10||108',
    ]);
  });

  it('dos pedidos: cada uno con su cierre y «Total de la semana» suma los totales con descuento', async () => {
    const f2 = sinDescuento(50);
    f2.folio = 'B-2';
    const lineas = [
      lista({ entregaId: 'e1', unidades: 10, precio: 12 }),
      lista({ folio: 'B-2', entregaId: 'e9', producto: 'Pan', unidades: 5, precio: 10 }),
    ];
    const t = texto((await leer([fila(), f2], lineas)).getWorksheet('Entregas')!);
    expect(t).toContain('Pedido 1|||');
    expect(t).toContain('Pedido 2|||');
    expect(t.slice(-5)).toEqual(['Pan|5|10|50', '|||', 'Total del pedido|5||50', '|||', 'Total de la semana|15||158']);
    expect(t.filter((x) => x.startsWith('Subtotal del pedido'))).toHaveLength(1);
  });

  it('un pedido heredado inconsistente conserva su Total y el bloque cuadra (descuento = subtotal − total)', async () => {
    const f = fila({ subtotal: 120, descuentoPorcentaje: 0, descuentoTotal: 0, total: 100 });
    const t = texto((await leer([f], [lista({ unidades: 10, precio: 12 })])).getWorksheet('Entregas')!);
    expect(t).toContain('Descuento (16.67%)|||20');
    expect(t[t.length - 1]).toBe('Total del pedido|10||100');
  });

  it('ni folio ni «Aelika» ni estados en ninguna celda ni propiedad', async () => {
    const libro = await leer([fila()], [linea()]);
    const todo = [libro.creator, libro.lastModifiedBy, libro.company, libro.title, ...libro.worksheets.map((w) => w.name)];
    libro.eachSheet((w) => w.eachRow((r) => r.eachCell((c) => todo.push(String(c.value ?? '')))));
    expect(todo.join('\n')).not.toMatch(/aelika|atrasada|B-1/i);
  });
});
