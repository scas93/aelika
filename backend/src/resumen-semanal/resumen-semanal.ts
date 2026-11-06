import { diaActualMexico } from '../common/horario';
import { sumarDiasISO } from '../pedidos-b2b/pedidos-b2b-logica';
import { semanasDelHorizonte } from '../portal/portal-calendario';
import { horaCdmx } from '../notificaciones-reglas/reserva-trigger';
import type { FilaPedidoExcel } from '../pedidos-b2b/pedidos-b2b-excel';

/**
 * Resumen semanal por correo (mayoreo): lógica PURA (sin base de datos ni red) — semana, ventana de envío, totales y contenido
 * del correo. Todo en hora de CDMX (America/Mexico_City, vía Intl), nunca la zona del servidor.
 */

/** Lunes 10:00 CDMX. */
export const DIA_ENVIO = 'lunes';
export const HORA_ENVIO = 10;

export interface SemanaResumen {
  /** Lunes, "YYYY-MM-DD". */
  inicio: string;
  /** Domingo, "YYYY-MM-DD". */
  fin: string;
}

/** Lunes y domingo de la semana ANTERIOR a la semana en curso (CDMX): la semana de los pedidos que resume el correo. */
export function semanaAnterior(ahora: Date): SemanaResumen {
  const inicio = sumarDiasISO(semanasDelHorizonte(ahora, 0)[0], -7);
  return { inicio, fin: sumarDiasISO(inicio, 6) };
}

/** ¿Toca el envío programado? Lunes (CDMX) desde las 10:00 hasta el fin del día: si el servidor estuvo caído a las 10, sale al volver. */
export function ventanaActivaResumen(ahora: Date): boolean {
  return diaActualMexico(ahora) === DIA_ENVIO && horaCdmx(ahora) >= HORA_ENVIO;
}

// ---------- Totales ----------

export interface TotalesResumen {
  /** Pedidos de la semana que NO están cancelados: base de todos los totales de abajo. */
  pedidos: number;
  porConfirmar: number;
  confirmados: number;
  enProceso: number;
  completados: number;
  /** Pedidos cancelados: aparte, no suman en nada de lo demás (ni sus piezas, ni su importe, ni sus entregas). */
  cancelados: number;
  piezas: number;
  /** Total en dinero (sin cancelados), en centavos para sumar sin errores de punto flotante. */
  totalCentavos: number;
  pagados: number;
  pagadoCentavos: number;
  pendientesDePago: number;
  pendienteCentavos: number;
  /** Entregas de los pedidos no cancelados, por estado. `canceladas` = entregas canceladas dentro de pedidos que siguen vivos. */
  entregas: { pendientes: number; listas: number; entregadas: number; noRecogidas: number; canceladas: number };
  /** Cualquier pedido de la semana (incluso cancelado): ¿hay algo que mandar? */
  hayPedidos: boolean;
}

const centavos = (n: number) => Math.round((n + Number.EPSILON) * 100);

/** Cuenta y suma sobre las MISMAS filas que arman la hoja «Pedidos» del Excel (FilaPedidoExcel): correo y adjunto no pueden discrepar. */
export function calcularTotales(filas: FilaPedidoExcel[]): TotalesResumen {
  const t: TotalesResumen = {
    pedidos: 0,
    porConfirmar: 0,
    confirmados: 0,
    enProceso: 0,
    completados: 0,
    cancelados: 0,
    piezas: 0,
    totalCentavos: 0,
    pagados: 0,
    pagadoCentavos: 0,
    pendientesDePago: 0,
    pendienteCentavos: 0,
    entregas: { pendientes: 0, listas: 0, entregadas: 0, noRecogidas: 0, canceladas: 0 },
    hayPedidos: filas.length > 0,
  };
  for (const f of filas) {
    if (f.cancelado) {
      t.cancelados += 1;
      continue;
    }
    t.pedidos += 1;
    if (f.estado === 'PENDIENTE_CONFIRMACION') t.porConfirmar += 1;
    else if (f.estado === 'CONFIRMADO_SURTIENDO') t.confirmados += 1;
    else if (f.estado === 'EN_PROCESO') t.enProceso += 1;
    else if (f.estado === 'COMPLETADO') t.completados += 1;
    t.piezas += f.totalPiezas;
    const total = centavos(f.total);
    t.totalCentavos += total;
    if (f.estadoPago === 'PAGADO') {
      t.pagados += 1;
      t.pagadoCentavos += total;
    } else {
      t.pendientesDePago += 1;
      t.pendienteCentavos += total;
    }
    for (const e of f.estadosEntregas) {
      if (e === 'PENDIENTE') t.entregas.pendientes += 1;
      else if (e === 'LISTA') t.entregas.listas += 1;
      else if (e === 'ENTREGADA') t.entregas.entregadas += 1;
      else if (e === 'NO_RECOGIDA') t.entregas.noRecogidas += 1;
      else if (e === 'CANCELADA') t.entregas.canceladas += 1;
    }
  }
  return t;
}

// ---------- Contenido ----------

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "2026-10-26" → "26 de octubre". */
export function fechaLarga(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES[m - 1]}`;
}

/** "26 de octubre al 1 de noviembre". */
export function rangoSemana(semana: SemanaResumen): string {
  return `${fechaLarga(semana.inicio)} al ${fechaLarga(semana.fin)}`;
}

const MONEDA = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
export const dinero = (cent: number) => MONEDA.format(cent / 100);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Una sola línea, sin caracteres de control (el nombre del negocio va al asunto del correo). */
const unaLinea = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

export interface CorreoResumen {
  asunto: string;
  texto: string;
  html: string;
}

/** Nombre del archivo del Excel: negocio + semana, sin caracteres que los sistemas de archivos no admiten (conserva acentos). */
export function nombreArchivoResumen(negocioNombre: string, semana: SemanaResumen): string {
  const negocio = unaLinea(negocioNombre).replace(/[\\/:*?"<>|]+/g, '').slice(0, 60).trim() || 'Negocio';
  return `Pedidos ${negocio} ${semana.inicio} al ${semana.fin}.xlsx`;
}

export function construirCorreoResumen(negocioNombre: string, semana: SemanaResumen, t: TotalesResumen): CorreoResumen {
  const negocio = unaLinea(negocioNombre) || 'Tu negocio';
  const rango = rangoSemana(semana);
  const asunto = `${negocio} · Resumen semanal · ${rango}`;
  const pie = 'Mensaje automático de Aelika. Si tienes dudas, revisa los pedidos en tu panel.';

  if (!t.hayPedidos) {
    const linea = `Sin pedidos esta semana (${rango}).`;
    return {
      asunto,
      texto: `${negocio}\nResumen semanal\n\n${linea}\n\n${pie}`,
      html: marco(negocio, rango, `<p style="margin:0 0 8px">${esc(linea)}</p>`, pie),
    };
  }

  const alertas: string[] = [];
  if (t.porConfirmar > 0) alertas.push(`${t.porConfirmar} ${t.porConfirmar === 1 ? 'pedido sigue' : 'pedidos siguen'} Por confirmar`);
  if (t.entregas.pendientes > 0) {
    alertas.push(`${t.entregas.pendientes} ${t.entregas.pendientes === 1 ? 'entrega sigue' : 'entregas siguen'} Pendiente${t.entregas.pendientes === 1 ? '' : 's'}`);
  }

  const filas: [string, string][][] = [
    [
      ['Pedidos', String(t.pedidos)],
      ['Por confirmar', String(t.porConfirmar)],
      ['Confirmados', String(t.confirmados)],
      ['En proceso', String(t.enProceso)],
      ['Completados', String(t.completados)],
      ['Piezas', String(t.piezas)],
      ['Total', dinero(t.totalCentavos)],
      ['Cancelados (no suman)', String(t.cancelados)],
    ],
    [
      ['Pagado', `${dinero(t.pagadoCentavos)} (${t.pagados} ${t.pagados === 1 ? 'pedido' : 'pedidos'})`],
      ['Pendiente de pago', `${dinero(t.pendienteCentavos)} (${t.pendientesDePago} ${t.pendientesDePago === 1 ? 'pedido' : 'pedidos'})`],
    ],
    [
      ['Pendientes', String(t.entregas.pendientes)],
      ['Listas', String(t.entregas.listas)],
      ['Entregadas', String(t.entregas.entregadas)],
      ['No recogidas', String(t.entregas.noRecogidas)],
      ['Canceladas (aparte)', String(t.entregas.canceladas)],
    ],
  ];
  const titulos = ['Pedidos', 'Cobranza', 'Entregas'];

  const texto = [
    `${negocio}`,
    `Resumen semanal · ${rango}`,
    '',
    ...(alertas.length > 0 ? ['POR REVISAR:', ...alertas.map((a) => `- ${a}`), ''] : []),
    ...filas.flatMap((bloque, i) => [titulos[i].toUpperCase(), ...bloque.map(([k, v]) => `${k}: ${v}`), '']),
    'El Excel adjunto trae el detalle de los pedidos y de sus entregas.',
    '',
    pie,
  ].join('\n');

  const bloquesHtml = filas
    .map(
      (bloque, i) =>
        `<h3 style="margin:18px 0 6px;font-size:15px">${titulos[i]}</h3><table style="border-collapse:collapse;width:100%">` +
        bloque
          .map(([k, v]) => `<tr><td style="padding:3px 0;color:#555">${esc(k)}</td><td style="padding:3px 0;text-align:right;font-weight:600">${esc(v)}</td></tr>`)
          .join('') +
        '</table>',
    )
    .join('');
  const alertaHtml =
    alertas.length > 0
      ? `<div style="background:#fff7e0;border:1px solid #f0c36d;border-radius:6px;padding:10px 12px;margin:0 0 6px"><strong>Por revisar</strong><ul style="margin:6px 0 0;padding-left:18px">${alertas.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>`
      : '';
  const html = marco(negocio, rango, `${alertaHtml}${bloquesHtml}<p style="margin:18px 0 0;color:#555">El Excel adjunto trae el detalle de los pedidos y de sus entregas.</p>`, pie);
  return { asunto, texto, html };
}

function marco(negocio: string, rango: string, cuerpo: string, pie: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;line-height:1.45"><h2 style="margin:0 0 2px">${esc(negocio)}</h2><p style="margin:0 0 14px;color:#555">Resumen semanal · ${esc(rango)}</p>${cuerpo}<hr style="border:none;border-top:1px solid #ddd;margin:20px 0 10px"><p style="margin:0;font-size:12px;color:#777">${esc(pie)}</p></div>`;
}
