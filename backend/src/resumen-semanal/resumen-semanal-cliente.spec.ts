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
        [1, 2, 3]
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

  it('Entregas: encabezado por entrega con piezas e importe, nota una sola vez, productos debajo y total al final', async () => {
    const lineas = [
      linea({ entregaId: 'e1', producto: 'Pan', unidades: 2, monto: 20, nota: 'Dejar en bodega' }),
      linea({ entregaId: 'e1', producto: 'Concha', unidades: 5, monto: 40, nota: 'Dejar en bodega' }),
      linea({ entregaId: 'e2', fecha: new Date('2026-10-29T00:00:00.000Z'), producto: 'Bolillo', unidades: 3, monto: 10 }),
    ];
    const libro = await leer([fila()], lineas);
    const h = libro.getWorksheet('Entregas')!;
    expect(texto(h)).toEqual([
      'Entrega / Producto|Unidades|Monto',
      'martes 27 de octubre|7|60',
      'Nota: Dejar en bodega||',
      'Concha|5|40',
      'Pan|2|20',
      '||',
      'jueves 29 de octubre|3|10',
      'Bolillo|3|10',
      '||',
      'Total del pedido|10|70',
    ]);
    expect(texto(h).join('\n').match(/Dejar en bodega/g)).toHaveLength(1);
  });

  it('ni folio ni «Aelika» ni estados en ninguna celda ni propiedad', async () => {
    const libro = await leer([fila()], [linea()]);
    const todo = [libro.creator, libro.lastModifiedBy, libro.company, libro.title, ...libro.worksheets.map((w) => w.name)];
    libro.eachSheet((w) => w.eachRow((r) => r.eachCell((c) => todo.push(String(c.value ?? '')))));
    expect(todo.join('\n')).not.toMatch(/aelika|atrasada|B-1/i);
  });
});
