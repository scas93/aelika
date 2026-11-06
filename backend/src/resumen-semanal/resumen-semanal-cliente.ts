import { fechaEnMexico } from '../common/horario';
import { sumarDiasISO } from '../pedidos-b2b/pedidos-b2b-logica';
import { horaCdmx } from '../notificaciones-reglas/reserva-trigger';
import type {
  FilaEntregaPedidoExcel,
  FilaPedidoExcel,
} from '../pedidos-b2b/pedidos-b2b-excel';
import { etiquetaEstadoEntrega } from '../pedidos-b2b/pedidos-b2b-excel';
import { round2 } from '../common/money';
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
 * NUNCA lleva estado de pago, fecha de pago, cobranza ni desglose de descuento (ni el cuerpo ni el Excel). Las entregas muestran
 * el importe ya con la parte del descuento que les toca (suman el Total del pedido) para no revelar el descuento.
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
const ESTADO_PEDIDO: Record<string, string> = {
  PENDIENTE_CONFIRMACION: 'Por confirmar',
  CONFIRMADO_SURTIENDO: 'Confirmado',
  EN_PROCESO: 'En proceso',
  COMPLETADO: 'Completado',
};

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

interface LineaPedido {
  folio: string;
  estado: string;
  cancelado: boolean;
  piezas: number;
  total: string;
  entregas: { dia: string; estado: string; piezas: number; importe: string }[];
}

function lineasDePedidos(
  filas: FilaPedidoExcel[],
  entregas: FilaEntregaPedidoExcel[],
): LineaPedido[] {
  return filas.map((f) => ({
    folio: f.folio,
    estado: f.cancelado ? 'Cancelado' : (ESTADO_PEDIDO[f.estado] ?? f.estado),
    cancelado: f.cancelado,
    piezas: f.totalPiezas,
    total: dinero(Math.round((f.total + Number.EPSILON) * 100)),
    entregas: f.cancelado
      ? []
      : entregas
          .filter((e) => e.folio === f.folio)
          .sort((a, b) => a.fecha.getTime() - b.fecha.getTime())
          .map((e) => ({
            dia: diaLargo(e.fecha),
            estado: e.atrasada ? 'Atrasada' : etiquetaEstadoEntrega(e.estado),
            piezas: e.piezas,
            importe: dinero(
              Math.round((round2(e.importe - e.descuento) + Number.EPSILON) * 100),
            ),
          })),
  }));
}

export function construirCorreoCliente(
  negocioNombre: string,
  clienteNombre: string,
  semana: SemanaResumen,
  t: TotalesResumen,
  filas: FilaPedidoExcel[],
  entregas: FilaEntregaPedidoExcel[],
): CorreoResumen {
  const negocio = unaLinea(negocioNombre) || 'tu proveedor';
  const cliente = unaLinea(clienteNombre);
  const rango = rangoSemana(semana);
  const asunto = `Tus pedidos con ${negocio}: ${rango}`;
  const encabezado = `Resumen semanal de tus pedidos con ${negocio}`;
  const pie = `Mensaje automático enviado por Aelika en nombre de ${negocio}. Si tienes dudas o no quieres recibir este correo, contacta a ${negocio}.`;

  const soloCancelados = t.pedidos === 0 && t.cancelados > 0;
  const alertas: string[] = [];
  if (t.porConfirmar > 0)
    alertas.push(
      `${t.porConfirmar} ${t.porConfirmar === 1 ? 'pedido sigue' : 'pedidos siguen'} Por confirmar`,
    );
  if (t.entregas.pendientes > 0)
    alertas.push(
      `${t.entregas.pendientes} ${t.entregas.pendientes === 1 ? 'entrega sigue' : 'entregas siguen'} Pendiente${t.entregas.pendientes === 1 ? '' : 's'}`,
    );

  const resumen: [string, string][] = soloCancelados
    ? [
        ['Pedidos', '0'],
        ['Total', dinero(0)],
        ['Cancelados (no suman)', String(t.cancelados)],
      ]
    : [
        ['Pedidos', String(t.pedidos)],
        ['Por confirmar', String(t.porConfirmar)],
        ['Confirmados', String(t.confirmados)],
        ['En proceso', String(t.enProceso)],
        ['Completados', String(t.completados)],
        ['Piezas', String(t.piezas)],
        ['Total', dinero(t.totalCentavos)],
        ['Cancelados (no suman)', String(t.cancelados)],
      ];
  const avisoCancelados = soloCancelados
    ? `Todos tus pedidos de esta semana (${t.cancelados}) están cancelados, por eso no suman en el total.`
    : '';
  const lineas = lineasDePedidos(filas, entregas);

  const texto = [
    negocio,
    `${encabezado} · ${rango}`,
    ...(cliente ? [`Cliente: ${cliente}`] : []),
    '',
    ...(avisoCancelados ? [avisoCancelados, ''] : []),
    ...(alertas.length > 0
      ? ['POR REVISAR:', ...alertas.map((a) => `- ${a}`), '']
      : []),
    'RESUMEN',
    ...resumen.map(([k, v]) => `${k}: ${v}`),
    '',
    'TUS PEDIDOS',
    ...lineas.flatMap((l) => [
      `Pedido ${l.folio} · ${l.estado}${l.cancelado ? '' : ` · ${l.piezas} piezas · ${l.total}`}`,
      ...l.entregas.map(
        (e) => `  - ${e.dia} · ${e.estado} · ${e.piezas} piezas · ${e.importe}`,
      ),
    ]),
    '',
    'El Excel adjunto trae el detalle de tus pedidos y de sus entregas.',
    '',
    pie,
  ].join('\n');

  const tablaResumen =
    '<table style="border-collapse:collapse;width:100%">' +
    resumen
      .map(
        ([k, v]) =>
          `<tr><td style="padding:3px 0;color:#555">${esc(k)}</td><td style="padding:3px 0;text-align:right;font-weight:600">${esc(v)}</td></tr>`,
      )
      .join('') +
    '</table>';
  const pedidosHtml = lineas
    .map(
      (l) =>
        `<div style="margin:0 0 12px;padding:8px 10px;border:1px solid #e3e3e3;border-radius:6px"><div><strong>Pedido ${esc(l.folio)}</strong> · ${esc(l.estado)}${l.cancelado ? '' : ` · ${l.piezas} ${l.piezas === 1 ? 'pieza' : 'piezas'} · ${esc(l.total)}`}</div>` +
        (l.entregas.length > 0
          ? '<table style="border-collapse:collapse;width:100%;margin-top:4px">' +
            l.entregas
              .map(
                (e) =>
                  `<tr><td style="padding:2px 0">${esc(e.dia)}</td><td style="padding:2px 6px">${esc(e.estado)}</td><td style="padding:2px 6px;text-align:right">${e.piezas} ${e.piezas === 1 ? 'pieza' : 'piezas'}</td><td style="padding:2px 0;text-align:right">${esc(e.importe)}</td></tr>`,
              )
              .join('') +
            '</table>'
          : '') +
        '</div>',
    )
    .join('');
  const alertaHtml =
    alertas.length > 0
      ? `<div style="background:#fff7e0;border:1px solid #f0c36d;border-radius:6px;padding:10px 12px;margin:0 0 6px"><strong>Por revisar</strong><ul style="margin:6px 0 0;padding-left:18px">${alertas.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>`
      : '';
  const avisoHtml = avisoCancelados
    ? `<p style="margin:0 0 10px;padding:8px 10px;background:#f4f4f4;border-radius:6px">${esc(avisoCancelados)}</p>`
    : '';
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;line-height:1.45">` +
    `<h2 style="margin:0 0 2px">${esc(encabezado)}</h2>` +
    `<p style="margin:0 0 14px;color:#555">${esc(rango)}${cliente ? ` · ${esc(cliente)}` : ''}</p>` +
    avisoHtml +
    alertaHtml +
    `<h3 style="margin:18px 0 6px;font-size:15px">Resumen</h3>${tablaResumen}` +
    `<h3 style="margin:18px 0 6px;font-size:15px">Tus pedidos</h3>${pedidosHtml}` +
    `<p style="margin:18px 0 0;color:#555">El Excel adjunto trae el detalle de tus pedidos y de sus entregas.</p>` +
    `<hr style="border:none;border-top:1px solid #ddd;margin:20px 0 10px"><p style="margin:0;font-size:12px;color:#777">${esc(pie)}</p></div>`;
  return { asunto, texto, html };
}
