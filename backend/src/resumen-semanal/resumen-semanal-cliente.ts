import { fechaEnMexico } from '../common/horario';
import { sumarDiasISO } from '../pedidos-b2b/pedidos-b2b-logica';
import { horaCdmx } from '../notificaciones-reglas/reserva-trigger';
import type { FilaPedidoExcel } from '../pedidos-b2b/pedidos-b2b-excel';
import type { LineaEntregaCliente } from './resumen-semanal-cliente-datos';
import {
  dinero,
  fechaLarga,
  HORA_ENVIO,
  rangoSemana,
  type CorreoResumen,
  type SemanaResumen,
  type TotalesResumen,
} from './resumen-semanal';

/**
 * Resumen semanal que recibe CADA cliente B2B (lógica PURA, sin base de datos ni red). Es un correo del negocio hacia su cliente:
 * NUNCA lleva estado de pago, fecha de pago, cobranza ni desglose de descuento (ni el cuerpo ni el Excel), ni estados de pedido o
 * de entrega: la única etiqueta de estado es «Cancelado», para que se entienda por qué algo no suma. Los montos de las entregas son
 * netos (ya con la parte del descuento que les toca) y suman el Total del pedido. Sin la marca de Aelika en nada visible.
 */

/**
 * Instante en que abre la ventana de envío de una semana: el lunes siguiente a `semana.fin` a las 10:00 CDMX. Se resuelve con
 * Intl (nunca con un desfase fijo): se prueban los desfases posibles y se queda el que cae a las 10:00 de ese día en CDMX.
 * Activar algo DESPUÉS de este instante no cuenta para esa semana (la activación nunca es retroactiva).
 */
export function inicioVentanaDeEnvio(semana: SemanaResumen): Date {
  const lunes = sumarDiasISO(semana.fin, 1);
  const [a, m, d] = lunes.split('-').map(Number);
  for (const desfase of [6, 5, 7, 4, 8]) {
    const candidato = new Date(Date.UTC(a, m - 1, d, HORA_ENVIO + desfase, 0));
    if (fechaEnMexico(candidato) === lunes && horaCdmx(candidato) === HORA_ENVIO)
      return candidato;
  }
  return new Date(Date.UTC(a, m - 1, d, HORA_ENVIO + 6, 0));
}

const DIAS = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const unaLinea = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** "2026-10-27" (fecha UTC a medianoche) → "martes 27 de octubre". */
function diaLargo(fecha: Date): string {
  const iso = fecha.toISOString().slice(0, 10);
  return `${DIAS[fecha.getUTCDay()]} ${fechaLarga(iso)}`;
}

const piezas = (n: number) => `${n} ${n === 1 ? 'pieza' : 'piezas'}`;
const pesos = (n: number) => dinero(Math.round((n + Number.EPSILON) * 100));

interface LineaPedido {
  folio: string;
  cancelado: boolean;
  piezas: number;
  total: string;
  entregas: { dia: string; piezas: number; importe: string }[];
}

function lineasDePedidos(
  filas: FilaPedidoExcel[],
  lineas: LineaEntregaCliente[],
): LineaPedido[] {
  return filas.map((f) => {
    // Una entrega por id (puede haber dos el mismo día); su importe es la suma de sus productos, ya netos.
    const porEntrega = new Map<
      string,
      { fecha: Date; piezas: number; centavos: number }
    >();
    if (!f.cancelado) {
      for (const l of lineas.filter((x) => x.folio === f.folio)) {
        const e = porEntrega.get(l.entregaId) ?? {
          fecha: l.fecha,
          piezas: 0,
          centavos: 0,
        };
        e.piezas += l.unidades;
        e.centavos += Math.round(l.monto * 100);
        porEntrega.set(l.entregaId, e);
      }
    }
    return {
      folio: f.folio,
      cancelado: f.cancelado,
      piezas: f.totalPiezas,
      total: pesos(f.total),
      entregas: [...porEntrega.values()]
        .sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
        .map((e) => ({
          dia: diaLargo(e.fecha),
          piezas: e.piezas,
          importe: dinero(e.centavos),
        })),
    };
  });
}

export function construirCorreoCliente(
  negocioNombre: string,
  clienteNombre: string,
  semana: SemanaResumen,
  t: TotalesResumen,
  filas: FilaPedidoExcel[],
  lineas: LineaEntregaCliente[],
): CorreoResumen {
  const negocio = unaLinea(negocioNombre) || 'tu proveedor';
  const cliente = unaLinea(clienteNombre);
  const rango = rangoSemana(semana);
  const asunto = `Tus pedidos con ${negocio}: ${rango}`;
  const encabezado = `Resumen semanal de tus pedidos con ${negocio}`;
  const pie = `Este es un mensaje automático. Para cualquier aclaración, comunícate con alguien del equipo de ${negocio}.`;

  const soloCancelados = t.pedidos === 0 && t.cancelados > 0;
  const avisoCancelados = soloCancelados
    ? `Todos tus pedidos de esta semana (${t.cancelados}) están cancelados, por eso no suman en el total.`
    : '';
  // Una sola línea: los pedidos vigentes y su total (los cancelados no suman).
  const resumen = `Pedidos: ${t.pedidos} · Total: ${dinero(soloCancelados ? 0 : t.totalCentavos)}`;
  const pedidos = lineasDePedidos(filas, lineas);

  const texto = [
    negocio,
    `${encabezado} · ${rango}`,
    ...(cliente ? [`Cliente: ${cliente}`] : []),
    '',
    ...(avisoCancelados ? [avisoCancelados, ''] : []),
    resumen,
    '',
    'TUS PEDIDOS',
    ...pedidos.flatMap((p) => [
      p.cancelado
        ? `Pedido ${p.folio} · Cancelado`
        : `Pedido ${p.folio} · ${piezas(p.piezas)} · ${p.total}`,
      ...p.entregas.map(
        (e) => `  - ${e.dia} · ${piezas(e.piezas)} · ${e.importe}`,
      ),
    ]),
    '',
    'El Excel adjunto trae el detalle de tus pedidos y de sus entregas.',
    '',
    pie,
  ].join('\n');

  const pedidosHtml = pedidos
    .map(
      (p) =>
        `<div style="margin:0 0 12px;padding:8px 10px;border:1px solid #e3e3e3;border-radius:6px"><div><strong>Pedido ${esc(p.folio)}</strong> · ${p.cancelado ? 'Cancelado' : `${piezas(p.piezas)} · ${esc(p.total)}`}</div>` +
        (p.entregas.length > 0
          ? '<table style="border-collapse:collapse;width:100%;margin-top:4px">' +
            p.entregas
              .map(
                (e) =>
                  `<tr><td style="padding:2px 0">${esc(e.dia)}</td><td style="padding:2px 6px;text-align:right">${piezas(e.piezas)}</td><td style="padding:2px 0;text-align:right">${esc(e.importe)}</td></tr>`,
              )
              .join('') +
            '</table>'
          : '') +
        '</div>',
    )
    .join('');
  const avisoHtml = avisoCancelados
    ? `<p style="margin:0 0 10px;padding:8px 10px;background:#f4f4f4;border-radius:6px">${esc(avisoCancelados)}</p>`
    : '';
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;line-height:1.45">` +
    `<h2 style="margin:0 0 2px">${esc(encabezado)}</h2>` +
    `<p style="margin:0 0 14px;color:#555">${esc(rango)}${cliente ? ` · ${esc(cliente)}` : ''}</p>` +
    avisoHtml +
    `<h3 style="margin:18px 0 6px;font-size:15px">Resumen</h3><p style="margin:0;font-weight:600">${esc(resumen)}</p>` +
    `<h3 style="margin:18px 0 6px;font-size:15px">Tus pedidos</h3>${pedidosHtml}` +
    `<p style="margin:18px 0 0;color:#555">El Excel adjunto trae el detalle de tus pedidos y de sus entregas.</p>` +
    `<hr style="border:none;border-top:1px solid #ddd;margin:20px 0 10px"><p style="margin:0;font-size:12px;color:#777">${esc(pie)}</p></div>`;
  return { asunto, texto, html };
}
