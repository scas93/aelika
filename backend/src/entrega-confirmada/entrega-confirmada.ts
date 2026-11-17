import { EstadoEntrega } from '../../generated/prisma/enums';
import { round2 } from '../common/money';
import {
  bloquesDePedido,
  etiquetaDescuento,
} from '../pedidos-b2b/pedidos-b2b-bloque-descuento';
import { diaLargo } from '../resumen-semanal/resumen-semanal-cliente-datos';
import { dinero, type CorreoResumen } from '../resumen-semanal/resumen-semanal';

/**
 * Correo «Entrega confirmada» que recibe el cliente B2B cuando UNA entrega pasa a Entregada (lógica PURA, sin base de datos ni red).
 * Mismo criterio que el resumen semanal por cliente: sin estado de pago, sin «Atrasada», sin la marca de Aelika, y los montos salen
 * del MISMO bloque Subtotal / Descuento / Total (`bloquesDePedido`) que usan los Excel, así que cuadran al centavo con ellos.
 */

export interface PedidoParaEntregaConfirmada {
  total: unknown;
  descuentoTotal: unknown;
  detalleB2b: { descuentoPorcentajeAplicado: unknown } | null;
  entregas: {
    id: string;
    estado: EstadoEntrega;
    fecha: Date;
    items: {
      cantidad: number;
      orderItem: { precioUnitario: unknown; nombreProducto: string };
    }[];
  }[];
}

export interface LineaEntregaConfirmada {
  producto: string;
  unidades: number;
  /** Precio unitario de lista. */
  precio: number;
  /** unidades × precio (lista, exacto). */
  monto: number;
}

export interface DatosEntregaConfirmada {
  /** Fecha de la entrega (medianoche UTC). */
  fecha: Date;
  lineas: LineaEntregaConfirmada[];
  subtotal: number;
  descuento: number;
  /** 0 = sin descuento. */
  porcentaje: number;
  total: number;
}

/**
 * Líneas y bloque de cierre de UNA entrega del pedido. Reparte el descuento entre las entregas NO canceladas con la misma regla y el
 * mismo orden (fecha, id) que el Excel del resumen por cliente (`bloquesDePedido` → `repartirDescuento`). `null` si la entrega no
 * existe, está cancelada o no tiene productos.
 */
export function datosEntregaConfirmada(
  pedido: PedidoParaEntregaConfirmada,
  entregaId: string,
): DatosEntregaConfirmada | null {
  const vivas = pedido.entregas
    .filter((e) => e.estado !== EstadoEntrega.CANCELADA && e.items.length > 0)
    .map((e) => {
      const lineas = e.items
        .map((i) => ({
          producto: i.orderItem.nombreProducto,
          unidades: i.cantidad,
          precio: Number(i.orderItem.precioUnitario),
          monto: round2(i.cantidad * Number(i.orderItem.precioUnitario)),
        }))
        .sort((a, b) => a.producto.localeCompare(b.producto, 'es'));
      return {
        id: e.id,
        fecha: e.fecha,
        lineas,
        importe: round2(lineas.reduce((s, l) => s + l.monto, 0)),
      };
    })
    .sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.id.localeCompare(b.id));
  const n = vivas.findIndex((e) => e.id === entregaId);
  if (n < 0) return null;
  const sumaLista = round2(vivas.reduce((s, e) => s + e.importe, 0));
  const porcentajePedido = Number(
    pedido.detalleB2b?.descuentoPorcentajeAplicado ?? 0,
  );
  const bloque = bloquesDePedido({
    entregas: vivas.map((e) => ({ importe: e.importe, fecha: e.fecha })),
    descuentoTotal: Number(pedido.descuentoTotal ?? 0),
    total: pedido.total === null || pedido.total === undefined ? sumaLista : Number(pedido.total),
    porcentaje: porcentajePedido,
  });
  const b = bloque.entregas[n];
  return {
    fecha: vivas[n].fecha,
    lineas: vivas[n].lineas,
    subtotal: b.subtotal,
    descuento: b.descuento,
    porcentaje: bloque.porcentaje,
    total: b.total,
  };
}

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
const pesos = (n: number) => dinero(Math.round((n + Number.EPSILON) * 100));

export function construirCorreoEntregaConfirmada(
  negocioNombre: string,
  clienteNombre: string,
  d: DatosEntregaConfirmada,
): CorreoResumen {
  const negocio = unaLinea(negocioNombre) || 'tu proveedor';
  const cliente = unaLinea(clienteNombre);
  const dia = diaLargo(d.fecha);
  const asunto = `Entrega confirmada · ${dia}`;
  const encabezado = 'Entrega confirmada';
  const aviso = `Tu entrega del ${dia} con ${negocio} fue entregada. Esto es lo que se entregó:`;
  const pie = `Este es un mensaje automático. Para cualquier aclaración, comunícate con alguien del equipo de ${negocio}.`;
  const conDescuento = d.descuento > 0;
  const cierre: { etiqueta: string; valor: string; fuerte: boolean }[] = [
    ...(conDescuento
      ? [
          { etiqueta: 'Subtotal', valor: pesos(d.subtotal), fuerte: false },
          { etiqueta: etiquetaDescuento(d.porcentaje), valor: `-${pesos(d.descuento)}`, fuerte: false },
        ]
      : []),
    { etiqueta: 'Total de la entrega', valor: pesos(d.total), fuerte: true },
  ];

  const texto = [
    negocio,
    `${encabezado} · ${dia}`,
    ...(cliente ? [`Cliente: ${cliente}`] : []),
    '',
    aviso,
    '',
    ...d.lineas.map(
      (l) => `- ${l.producto} · ${l.unidades} × ${pesos(l.precio)} = ${pesos(l.monto)}`,
    ),
    '',
    ...cierre.map((c) => `${c.etiqueta}: ${c.valor}`),
    '',
    pie,
  ].join('\n');

  const celda = 'padding:6px 8px;border-bottom:1px solid #e3e3e3';
  const filas = d.lineas
    .map(
      (l) =>
        `<tr><td style="${celda}">${esc(l.producto)}</td><td style="${celda};text-align:right">${l.unidades}</td><td style="${celda};text-align:right">${esc(pesos(l.precio))}</td><td style="${celda};text-align:right">${esc(pesos(l.monto))}</td></tr>`,
    )
    .join('');
  const cabeza = 'padding:6px 8px;text-align:right;border-bottom:2px solid #ccc;font-size:13px;color:#555';
  const cierreHtml = cierre
    .map(
      (c) =>
        `<tr><td style="padding:3px 8px;text-align:right${c.fuerte ? ';font-weight:700' : ';color:#555'}">${esc(c.etiqueta)}</td><td style="padding:3px 8px;text-align:right;width:110px${c.fuerte ? ';font-weight:700' : ''}">${esc(c.valor)}</td></tr>`,
    )
    .join('');
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;line-height:1.45">` +
    `<h2 style="margin:0 0 2px">${esc(encabezado)}</h2>` +
    `<p style="margin:0 0 14px;color:#555">${esc(dia)}${cliente ? ` · ${esc(cliente)}` : ''}</p>` +
    `<p style="margin:0 0 10px">${esc(aviso)}</p>` +
    `<table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr><th style="${cabeza.replace('text-align:right', 'text-align:left')}">Producto</th><th style="${cabeza}">Unidades</th><th style="${cabeza}">Precio unitario</th><th style="${cabeza}">Monto</th></tr></thead><tbody>${filas}</tbody></table>` +
    `<table style="border-collapse:collapse;width:100%;font-size:14px;margin-top:6px"><tbody>${cierreHtml}</tbody></table>` +
    `<hr style="border:none;border-top:1px solid #ddd;margin:20px 0 10px"><p style="margin:0;font-size:12px;color:#777">${esc(pie)}</p></div>`;
  return { asunto, texto, html };
}
