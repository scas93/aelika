import { BadRequestException } from '@nestjs/common';
import { FacturacionModo } from '../../generated/prisma/client';

// Shared by both public checkout services (Order in public/, PedidoB2b in
// pedidos-b2b/) — same Tenant.facturacionModo, same 6 factura* fields, same
// rules. Extracted here instead of duplicated so the two storefronts can't
// drift on what "OBLIGATORIO"/"OPCIONAL" actually require.
export interface FacturaFields {
  requiereFactura: boolean;
  facturaRazonSocial: string | null;
  facturaRfc: string | null;
  facturaRegimenFiscal: string | null;
  facturaUsoCfdi: string | null;
  facturaCodigoPostal: string | null;
  facturaCorreo: string | null;
}

export const FACTURA_VACIA: FacturaFields = {
  requiereFactura: false,
  facturaRazonSocial: null,
  facturaRfc: null,
  facturaRegimenFiscal: null,
  facturaUsoCfdi: null,
  facturaCodigoPostal: null,
  facturaCorreo: null,
};

// Shape both CreatePublicOrderDto and CreatePedidoB2bDto satisfy — only the
// fields this module actually reads.
export interface FacturaInput {
  requiereFactura?: boolean;
  facturaRazonSocial?: string;
  facturaRfc?: string;
  facturaRegimenFiscal?: string;
  facturaUsoCfdi?: string;
  facturaCodigoPostal?: string;
  facturaCorreo?: string;
}

/**
 * Resolves the factura* fields to actually store, based on
 * Tenant.facturacionModo:
 *  - DESACTIVADO: whatever the client sent is ignored outright (whitelist).
 *  - OBLIGATORIO: requiereFactura must be true, and then every factura*
 *    field is required.
 *  - OPCIONAL: requiereFactura may be true or false; true requires every
 *    field just like OBLIGATORIO, false ignores them like DESACTIVADO.
 */
export function resolverFacturacion(
  modo: FacturacionModo,
  dto: FacturaInput,
): FacturaFields {
  if (modo === FacturacionModo.DESACTIVADO) {
    return FACTURA_VACIA;
  }

  if (modo === FacturacionModo.OBLIGATORIO && dto.requiereFactura !== true) {
    throw new BadRequestException(
      'Este negocio requiere factura para todos los pedidos',
    );
  }

  if (modo === FacturacionModo.OPCIONAL && dto.requiereFactura !== true) {
    return FACTURA_VACIA;
  }

  // From here on: OBLIGATORIO, or OPCIONAL con requiereFactura = true — cada
  // campo factura* es obligatorio.
  const campos = {
    facturaRazonSocial: dto.facturaRazonSocial,
    facturaRfc: dto.facturaRfc,
    facturaRegimenFiscal: dto.facturaRegimenFiscal,
    facturaUsoCfdi: dto.facturaUsoCfdi,
    facturaCodigoPostal: dto.facturaCodigoPostal,
    facturaCorreo: dto.facturaCorreo,
  };
  const faltantes = Object.entries(campos)
    .filter(([, valor]) => !valor?.trim())
    .map(([campo]) => campo);
  if (faltantes.length > 0) {
    throw new BadRequestException(
      `Faltan datos de factura: ${faltantes.join(', ')}`,
    );
  }

  // Cada campo arriba ya se confirmó no vacío — el cast solo refleja eso al
  // type checker.
  return { requiereFactura: true, ...campos } as FacturaFields;
}
