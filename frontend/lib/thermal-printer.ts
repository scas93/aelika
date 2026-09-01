import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";
import { METODO_PAGO_LABEL, type Order, type PedidoB2bEntregaDia, type PublicOrderItem, type Role } from "./api";
import { regimenFiscalLabel, usoCfdiLabel } from "./catalogos-sat";

// GHIA GTP801, 80mm — Font A fits ~42-48 chars at this width; 42 is the
// conservative choice so lines don't wrap unexpectedly on narrower printers.
// Used only for the header (business name, folio, delivery timing).
const COLUMNS = 42;

// Font B (condensed) — used for all body text below the header, denser like
// a traditional POS ticket. The encoder has no printerModel configured, so
// it falls back to its default capability profile: Font A = 42 columns,
// Font B = 56, and it scales Font B's width proportionally to whatever
// `columns` was passed at construction (which equals Font A's own width
// here) — see the font() implementation in receipt-printer-encoder. That
// makes 56 the real, exact usable width once .font("B") is active, not an
// approximation — verified by decoding real encoder output at that width.
// Exported so ComandaImprimible can feed the same budget into
// cabeEnUnaLinea() and make the identical one-line-vs-two-lines call.
export const COLUMNS_BODY = 56;

// Same timezone convention as backend/src/common/horario.ts and
// lib/horario.ts — Fase 1 pilots all operate in Mexico City.
const TIMEZONE = "America/Mexico_City";

export const ROLE_LABEL: Record<Role, string> = {
  OPERADOR: "Operador",
  GERENTE: "Gerente",
  DUENO: "Dueño",
};

/** "D-M-YYYY HH:mm" in the tenant timezone — used for both the order's own
    creation time and the print timestamp on the ticket. */
export function formatFechaHora(date: Date): string {
  const formatter = new Intl.DateTimeFormat("es-MX", {
    timeZone: TIMEZONE,
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}:${get("minute")}`;
}

// Everything both ticket surfaces (buildComandaBytes for WebUSB, and
// ComandaImprimible for the browser-print fallback) need beyond the order
// itself — bundled into one shape so both are built from the exact same
// inputs and can't drift out of sync with each other again (ComandaImprimible
// used to be missing nombreNegocio entirely).
export interface ComandaContext {
  nombreNegocio: string;
  ubicacionNegocio: string | null;
  nombrePuntoEnvio: string | undefined;
  impresoPor: { nombre: string; rol: Role };
}

export function isWebUsbSupported(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

// Reuses a previously-authorized device silently (navigator.usb.getDevices())
// so the browser's picker only appears once per computer — requestDevice()
// only runs the first time, or again if the user revokes the permission.
async function getUsbDevice(): Promise<USBDevice> {
  const authorized = await navigator.usb.getDevices();
  if (authorized.length > 0) {
    return authorized[0];
  }

  try {
    return await navigator.usb.requestDevice({ filters: [] });
  } catch {
    throw new Error("No se seleccionó ninguna impresora.");
  }
}

async function claimOutEndpoint(device: USBDevice): Promise<number> {
  if (!device.opened) {
    await device.open();
  }
  if (device.configuration === null) {
    await device.selectConfiguration(1);
  }

  for (const iface of device.configuration!.interfaces) {
    for (const alternate of iface.alternates) {
      const outEndpoint = alternate.endpoints.find((endpoint) => endpoint.direction === "out");
      if (outEndpoint) {
        await device.claimInterface(iface.interfaceNumber);
        return outEndpoint.endpointNumber;
      }
    }
  }

  throw new Error("La impresora no tiene un endpoint de salida reconocible.");
}

// Shared with dashboard/pedidos/page.tsx's ComandaImprimible (browser print
// fallback) so the panel and the WebUSB ticket never disagree on wording —
// see entregaLinea() there.
export function entregaLinea(order: Order, nombrePuntoEnvio: string | undefined): string {
  return order.metodoEntrega === "DOMICILIO"
    ? `Envío a domicilio · ${nombrePuntoEnvio ?? "Zona no disponible"}`
    : "Recoger en tienda";
}

export function precioLineaItem(item: PublicOrderItem): string {
  return `$${(item.cantidad * Number(item.precioUnitario)).toFixed(2)}`;
}

// Shared with ComandaImprimible so both surfaces make the exact same
// line-or-two-lines decision for every item — same reasoning as
// entregaLinea() above, so a long product name never lands on one line in
// WebUSB and two lines in the browser fallback (or vice versa).
export function cabeEnUnaLinea(izquierda: string, derecha: string, columns: number): boolean {
  return izquierda.length + 1 + derecha.length <= columns;
}

// Encoder-only: raw text has no CSS, so the right-aligned column has to be
// built by hand with literal spaces. ComandaImprimible doesn't need this —
// it right-aligns with flexbox instead.
function padColumnas(izquierda: string, derecha: string, columns: number): string {
  const espacio = Math.max(1, columns - izquierda.length - derecha.length);
  return izquierda + " ".repeat(espacio) + derecha;
}

function buildComandaBytes(order: Order, ctx: ComandaContext): Uint8Array<ArrayBuffer> {
  const horaRecogidaDisplay =
    order.horaRecogidaTipo === "HORA_ESPECIFICA" && order.horaRecogida
      ? `Recoge: ${order.horaRecogida}`
      : "Lo antes posible";

  const encoder = new ReceiptPrinterEncoder({ language: "esc-pos", columns: COLUMNS });

  // Header stays in Font A (wide/normal) — business name and folio are the
  // only "destacado" elements on the ticket. Everything else below switches
  // to Font B (condensed) for a denser, traditional-POS-ticket look.
  encoder.initialize().align("center").font("A").bold(true).line(ctx.nombreNegocio).bold(false).font("B");

  if (ctx.ubicacionNegocio) {
    encoder.line(ctx.ubicacionNegocio);
  }

  encoder
    .font("A")
    .size(2, 2)
    .bold(true)
    .line(`#${order.folio}`)
    .bold(false)
    .size(1, 1)
    .bold(true)
    .line(order.metodoEntrega === "DOMICILIO" ? "A domicilio" : horaRecogidaDisplay)
    .bold(false)
    .font("B")
    .align("left")
    .rule({ width: COLUMNS_BODY })
    .bold(true)
    .line(entregaLinea(order, ctx.nombrePuntoEnvio))
    .bold(false)
    .line(order.clienteNombre)
    .line(order.clienteTelefono)
    .rule({ width: COLUMNS_BODY })
    .line(`Pedido: ${formatFechaHora(new Date(order.createdAt))}`)
    .rule({ width: COLUMNS_BODY });

  for (const item of order.items) {
    const nombreLinea = `${item.cantidad}x ${item.nombreProducto}`;
    const precioTexto = precioLineaItem(item);
    encoder.bold(true);
    if (cabeEnUnaLinea(nombreLinea, precioTexto, COLUMNS_BODY)) {
      encoder.line(padColumnas(nombreLinea, precioTexto, COLUMNS_BODY));
    } else {
      // Name alone can still wrap further if it doesn't fit COLUMNS_BODY —
      // .line() wraps automatically. The price always gets its own line
      // right below, never squeezed next to the name's last wrapped line.
      encoder.line(nombreLinea).align("right").line(precioTexto).align("left");
    }
    encoder.bold(false);
  }

  if (order.notas) {
    encoder.invert(true).bold(true).line(" NOTAS ").line(order.notas).bold(false).invert(false);
  }

  encoder
    .rule({ width: COLUMNS_BODY })
    .line(padColumnas(METODO_PAGO_LABEL[order.metodoPago] ?? order.metodoPago, `$${Number(order.total).toFixed(2)}`, COLUMNS_BODY));

  if (Number(order.descuentoTotal) > 0) {
    encoder.line(`Descuento: -$${Number(order.descuentoTotal).toFixed(2)}`);
  }

  encoder
    .bold(true)
    .line(`Total: $${Number(order.total).toFixed(2)}`)
    .bold(false);

  // Full fiscal data, one field per line — deliberately not compressed onto
  // fewer lines. Font B at 56 columns has plenty of width; the risk here
  // is fields running together and becoming unreadable, not running out of
  // paper.
  if (order.requiereFactura) {
    encoder
      .invert(true)
      .bold(true)
      .line(" DATOS FISCALES ")
      .bold(false)
      .invert(false)
      .line(`Razón social: ${order.facturaRazonSocial ?? ""}`)
      .line(`RFC: ${order.facturaRfc ?? ""}`)
      .line(`Régimen fiscal: ${regimenFiscalLabel(order.facturaRegimenFiscal)}`)
      .line(`Uso de CFDI: ${usoCfdiLabel(order.facturaUsoCfdi)}`)
      .line(`C.P. fiscal: ${order.facturaCodigoPostal ?? ""}`)
      .line(`Correo: ${order.facturaCorreo ?? ""}`);
  }

  encoder
    .rule({ width: COLUMNS_BODY })
    .line(`Impreso por: ${ctx.impresoPor.nombre} (${ROLE_LABEL[ctx.impresoPor.rol]})`)
    .line(`Fecha de impresión: ${formatFechaHora(new Date())}`)
    .align("center")
    .line("Gracias por su preferencia")
    .align("left");

  encoder.newline(3).cut();

  return encoder.encode();
}

// Extraído de lo que antes era el cuerpo de printComandaWebUsb — el plan de
// bytes ESC/POS es lo único que cambia entre un ticket de Order y uno de
// "Pedidos del día" (PedidoB2bEntregaDia); el mecanismo de transporte
// (conseguir el dispositivo, reclamar el endpoint, transferOut, cerrar) es
// idéntico y se reutiliza tal cual para no duplicar la conexión WebUSB.
async function enviarBytesWebUsb(data: Uint8Array<ArrayBuffer>): Promise<void> {
  if (!isWebUsbSupported()) {
    throw new Error("Esta función requiere Chrome o Edge.");
  }

  const device = await getUsbDevice();

  try {
    const endpointNumber = await claimOutEndpoint(device);
    await device.transferOut(endpointNumber, data);
  } catch (err) {
    if (err instanceof Error && err.message.includes("endpoint de salida")) {
      throw err;
    }
    throw new Error(
      "No se pudo conectar con la impresora. Verifica que esté encendida y conectada por USB, y vuelve a intentar.",
    );
  } finally {
    await device.close().catch(() => {});
  }
}

export async function printComandaWebUsb(order: Order, ctx: ComandaContext): Promise<void> {
  const data = buildComandaBytes(order, ctx);
  await enviarBytesWebUsb(data);
}

// Contexto para el ticket de "Pedidos del día" — distinto de ComandaContext
// (Order): no hay hora de recogida/punto de envío/factura, solo el negocio
// del tenant (quien imprime) y la fecha/día que se está despachando.
export interface ComandaB2bDiaContext {
  nombreNegocioTenant: string;
  fechaLabel: string;
  impresoPor: { nombre: string; rol: Role };
}

// Ticket de picking/entrega para un solo día de un PedidoB2b — nunca el
// pedido semanal completo (entrega.items ya viene recortado a un día desde
// el backend, ver PedidosB2bService.findEntregasDia). Sin precios: es una
// lista de qué empacar/entregar, no un recibo — el cobro de PedidoB2b es a
// crédito y se resuelve al final de la semana, no en este ticket.
function buildComandaB2bDiaBytes(entrega: PedidoB2bEntregaDia, ctx: ComandaB2bDiaContext): Uint8Array<ArrayBuffer> {
  const encoder = new ReceiptPrinterEncoder({ language: "esc-pos", columns: COLUMNS });

  encoder.initialize().align("center").font("A").bold(true).line(ctx.nombreNegocioTenant).bold(false).font("B");

  encoder
    .font("A")
    .size(2, 2)
    .bold(true)
    .line(`#${entrega.folio}`)
    .bold(false)
    .size(1, 1)
    .bold(true)
    .line(`Entrega: ${ctx.fechaLabel}`)
    .bold(false)
    .font("B")
    .align("left")
    .rule({ width: COLUMNS_BODY })
    .bold(true)
    .line(`Nombre del negocio: ${entrega.negocioNombre}`)
    .bold(false)
    .line(`Nombre del contacto: ${entrega.contactoNombre}`)
    .line(`Teléfono de contacto: ${entrega.contactoTelefono}`)
    .rule({ width: COLUMNS_BODY })
    .line("Pedido a preparar:");

  for (const item of entrega.items) {
    encoder.bold(true).line(`${item.cantidad}x ${item.nombreProducto}`).bold(false);
  }

  encoder
    .rule({ width: COLUMNS_BODY })
    .line(`Impreso por: ${ctx.impresoPor.nombre} (${ROLE_LABEL[ctx.impresoPor.rol]})`)
    .line(`Fecha de impresión: ${formatFechaHora(new Date())}`)
    .newline(2);

  encoder.newline(3).cut();

  return encoder.encode();
}

export async function printComandaB2bDiaWebUsb(entrega: PedidoB2bEntregaDia, ctx: ComandaB2bDiaContext): Promise<void> {
  const data = buildComandaB2bDiaBytes(entrega, ctx);
  await enviarBytesWebUsb(data);
}
