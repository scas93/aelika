import { createHash } from 'crypto';
import { normalizarTelefono } from './telefono';

// Huella del "intento de compra" TARJETA (Parte B1): dos envíos con la misma huella son el mismo
// intento y reutilizan el pedido pendiente en vez de crear otro. Se calcula SIEMPRE sobre valores
// ya resueltos por el servidor (factura tras resolverFacturacion, dirección tras
// resolverDireccionEntrega, total recalculado), nunca sobre el DTO crudo — así un campo que el
// servidor ignora (ej. factura* con facturacionModo DESACTIVADO) no cambia la huella.
// horaRecogida/horaRecogidaTipo NO entran: las opciones rápidas ("en 15 min") la recalculan en
// cada envío. Prefijo de versión para poder cambiar los campos sin colisionar con huellas viejas.
const VERSION = 'v1';

export interface LineaHuella {
  productId: string;
  cantidad: number;
  modifierOptionIds?: string[];
}

export interface EntradaHuella {
  tenantId: string;
  clienteTelefono: string;
  clienteNombre: string;
  clienteCorreo?: string | null;
  items: LineaHuella[];
  metodoEntrega: string;
  puntoEnvioId?: string | null;
  direccion: {
    direccionCalle: string | null;
    direccionNumero: string | null;
    direccionColonia: string | null;
    direccionReferencias: string | null;
  };
  notas?: string | null;
  factura: {
    requiereFactura: boolean;
    facturaRazonSocial: string | null;
    facturaRfc: string | null;
    facturaRegimenFiscal: string | null;
    facturaUsoCfdi: string | null;
    facturaCodigoPostal: string | null;
    facturaCorreo: string | null;
  };
  total: number;
}

/** undefined, null y "" equivalen; se recorta. */
function texto(valor: string | null | undefined): string {
  return (valor ?? '').trim();
}

/** Nombre comparable: sin acentos, minúsculas y espacios colapsados. Para empatar intentos del mismo cliente. */
export function normalizarNombre(nombre: string | null | undefined): string {
  return texto(nombre)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Líneas idénticas (mismo producto y mismos modificadores) se fusionan sumando cantidad; orden canónico. */
export function carritoCanonico(items: LineaHuella[]): string[] {
  const acumulado = new Map<string, number>();
  for (const item of items) {
    const mods = [...(item.modifierOptionIds ?? [])].sort();
    const clave = `${item.productId}[${mods.join(',')}]`;
    acumulado.set(clave, (acumulado.get(clave) ?? 0) + item.cantidad);
  }
  return [...acumulado.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([clave, cantidad]) => `${clave}x${cantidad}`);
}

export function calcularHuellaCheckout(e: EntradaHuella): string {
  const campos = [
    VERSION,
    e.tenantId,
    'TARJETA',
    normalizarTelefono(e.clienteTelefono),
    texto(e.clienteNombre),
    texto(e.clienteCorreo),
    carritoCanonico(e.items).join(';'),
    e.metodoEntrega,
    texto(e.puntoEnvioId),
    texto(e.direccion.direccionCalle),
    texto(e.direccion.direccionNumero),
    texto(e.direccion.direccionColonia),
    texto(e.direccion.direccionReferencias),
    texto(e.notas),
    e.factura.requiereFactura ? '1' : '0',
    texto(e.factura.facturaRazonSocial),
    texto(e.factura.facturaRfc),
    texto(e.factura.facturaRegimenFiscal),
    texto(e.factura.facturaUsoCfdi),
    texto(e.factura.facturaCodigoPostal),
    texto(e.factura.facturaCorreo),
    e.total.toFixed(2),
  ];
  // JSON como serialización: sin ambigüedad de separadores dentro de los campos.
  return createHash('sha256').update(JSON.stringify(campos)).digest('hex');
}
