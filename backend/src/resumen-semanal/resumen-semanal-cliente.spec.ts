import {
  construirCorreoCliente,
  inicioVentanaDeEnvio,
} from './resumen-semanal-cliente';
import { calcularTotales } from './resumen-semanal';
import type {
  FilaEntregaPedidoExcel,
  FilaPedidoExcel,
} from '../pedidos-b2b/pedidos-b2b-excel';
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
const entrega = (extra: Partial<FilaEntregaPedidoExcel> = {}): FilaEntregaPedidoExcel => ({
  fecha: new Date('2026-10-27T00:00:00.000Z'),
  folio: 'B-1',
  clienteCodigo: 'banetto-cafe',
  negocioNombre: 'Café Ñandú',
  estado: 'PENDIENTE',
  atrasada: false,
  piezas: 10,
  importe: 120,
  descuento: 12,
  cerradaAt: null,
  nota: null,
  ...extra,
});
const armar = (filas: FilaPedidoExcel[], entregas: FilaEntregaPedidoExcel[]) =>
  construirCorreoCliente('Banetto', 'Café Ñandú', SEMANA, calcularTotales(filas), filas, entregas);

describe('construirCorreoCliente', () => {
  it('asunto, encabezado y pie con el nombre del negocio', () => {
    const c = armar([fila()], [entrega()]);
    expect(c.asunto).toBe('Tus pedidos con Banetto: 26 de octubre al 1 de noviembre');
    expect(c.html).toContain('Resumen semanal de tus pedidos con Banetto');
    expect(c.texto).toContain(
      'Mensaje automático enviado por Aelika en nombre de Banetto. Si tienes dudas o no quieres recibir este correo, contacta a Banetto.',
    );
    expect(c.html).toContain(
      'Mensaje automático enviado por Aelika en nombre de Banetto. Si tienes dudas o no quieres recibir este correo, contacta a Banetto.',
    );
  });

  it('NO menciona pago, cobranza ni descuento, y las entregas muestran el importe ya con descuento (suman el total)', () => {
    const c = armar([fila()], [entrega()]);
    for (const t of [c.texto, c.html, c.asunto]) {
      expect(t).not.toMatch(/pago|pagad|cobranza|descuento|pendiente de/i);
    }
    // 120 - 12 = 108 en la entrega; 108 de total del pedido.
    expect(c.texto).toContain('martes 27 de octubre · Pendiente · 10 piezas · $108.00');
    expect(c.texto).toContain('Pedido B-1 · Por confirmar · 10 piezas · $108.00');
    expect(c.texto).not.toContain('$120.00');
    expect(c.texto).not.toContain('$12.00');
  });

  it('resalta lo Por confirmar y las entregas Pendientes', () => {
    const c = armar([fila()], [entrega()]);
    expect(c.texto).toContain('POR REVISAR');
    expect(c.texto).toContain('1 pedido sigue Por confirmar');
    expect(c.texto).toContain('1 entrega sigue Pendiente');
  });

  it('pedidos cancelados salen marcados y no suman; si es lo único lo dice claro, con totales en cero', () => {
    const cancelado = fila({ folio: 'B-2', cancelado: true, estadosEntregas: ['CANCELADA'], total: 50 });
    const mixto = armar([fila(), cancelado], [entrega()]);
    expect(mixto.texto).toContain('Pedido B-2 · Cancelado');
    expect(mixto.texto).toContain('Cancelados (no suman): 1');
    expect(mixto.texto).toContain('Pedidos: 1');
    const solo = armar([cancelado], []);
    expect(solo.texto).toContain('Todos tus pedidos de esta semana (1) están cancelados');
    expect(solo.texto).toContain('Pedidos: 0');
    expect(solo.texto).toContain('Total: $0.00');
    expect(solo.texto).not.toContain('POR REVISAR');
  });

  it('escapa HTML y conserva acentos y ñ', () => {
    const c = construirCorreoCliente(
      'Panadería <Ñ> & Co',
      'Cliente "Ñ"',
      SEMANA,
      calcularTotales([fila()]),
      [fila()],
      [entrega()],
    );
    expect(c.html).toContain('Panadería &lt;Ñ&gt; &amp; Co');
    expect(c.html).toContain('Cliente &quot;Ñ&quot;');
    expect(c.asunto).toBe('Tus pedidos con Panadería <Ñ> & Co: 26 de octubre al 1 de noviembre');
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
