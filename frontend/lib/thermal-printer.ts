import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";
import { METODO_PAGO_LABEL, type Order } from "./api";

// GHIA GTP801, 80mm — Font A fits ~42-48 chars at this width; 42 is the
// conservative choice so lines don't wrap unexpectedly on narrower printers.
const COLUMNS = 42;

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

function buildComandaBytes(order: Order, nombreNegocio: string, nombrePuntoEnvio: string | undefined): Uint8Array<ArrayBuffer> {
  const horaRecogidaDisplay =
    order.horaRecogidaTipo === "HORA_ESPECIFICA" && order.horaRecogida
      ? `Recoge: ${order.horaRecogida}`
      : "Lo antes posible";

  const encoder = new ReceiptPrinterEncoder({ language: "esc-pos", columns: COLUMNS });

  encoder
    .initialize()
    .align("center")
    .bold(true)
    .line(nombreNegocio)
    .bold(false)
    .newline()
    .size(2, 2)
    .bold(true)
    .line(`#${order.folio}`)
    .bold(false)
    .size(1, 1)
    .bold(true)
    .line(order.metodoEntrega === "DOMICILIO" ? "A domicilio" : horaRecogidaDisplay)
    .bold(false)
    .align("left")
    .rule()
    .bold(true)
    .line(entregaLinea(order, nombrePuntoEnvio))
    .bold(false)
    .line(order.clienteNombre)
    .line(order.clienteTelefono)
    .rule();

  for (const item of order.items) {
    encoder
      .bold(true)
      .size(1, 2)
      .line(`${item.cantidad}x ${item.nombreProducto}`)
      .size(1, 1)
      .bold(false);
  }

  if (order.notas) {
    encoder.newline().invert(true).bold(true).line(" NOTAS ").line(order.notas).bold(false).invert(false);
  }

  encoder.rule().line(METODO_PAGO_LABEL[order.metodoPago] ?? order.metodoPago);

  if (Number(order.descuentoTotal) > 0) {
    encoder.line(`Descuento: -$${Number(order.descuentoTotal).toFixed(2)}`);
  }

  encoder
    .bold(true)
    .line(`Total: $${Number(order.total).toFixed(2)}`)
    .bold(false);

  // Full fiscal data, one field per line — deliberately not compressed onto
  // fewer lines. 80mm paper at 42 columns has plenty of width; the risk here
  // is fields running together and becoming unreadable, not running out of
  // paper.
  if (order.requiereFactura) {
    encoder
      .newline()
      .invert(true)
      .bold(true)
      .line(" DATOS FISCALES ")
      .bold(false)
      .invert(false)
      .line(`Razón social: ${order.facturaRazonSocial ?? ""}`)
      .line(`RFC: ${order.facturaRfc ?? ""}`)
      .line(`Régimen fiscal: ${order.facturaRegimenFiscal ?? ""}`)
      .line(`Uso de CFDI: ${order.facturaUsoCfdi ?? ""}`)
      .line(`C.P. fiscal: ${order.facturaCodigoPostal ?? ""}`)
      .line(`Correo: ${order.facturaCorreo ?? ""}`);
  }

  encoder.newline(3).cut();

  return encoder.encode();
}

export async function printComandaWebUsb(order: Order, nombreNegocio: string, nombrePuntoEnvio?: string): Promise<void> {
  if (!isWebUsbSupported()) {
    throw new Error("Esta función requiere Chrome o Edge.");
  }

  const device = await getUsbDevice();

  try {
    const endpointNumber = await claimOutEndpoint(device);
    const data = buildComandaBytes(order, nombreNegocio, nombrePuntoEnvio);
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
