import { BadRequestException } from '@nestjs/common';
import { PedidoB2bModoCobro } from '../../generated/prisma/enums';

/**
 * Modalidades de cobro B2B (Configuración de pagos, Fase 0). Los valores internos son los del enum PedidoB2bModoCobro
 * (AL_INICIO / AL_FINAL); lo que ve el usuario sale de ETIQUETA_MODALIDAD, el único mapa de nombres del backend.
 */
export const MODALIDADES_COBRO: readonly PedidoB2bModoCobro[] = [
  PedidoB2bModoCobro.AL_FINAL,
  PedidoB2bModoCobro.AL_INICIO,
];

export const ETIQUETA_MODALIDAD: Record<PedidoB2bModoCobro, string> = {
  AL_FINAL: 'A crédito',
  AL_INICIO: 'Pago por adelantado',
};

/** Lo que tiene activo un negocio nuevo (y el default de la columna): solo «A crédito». */
export const MODALIDADES_POR_DEFECTO: readonly PedidoB2bModoCobro[] = [
  PedidoB2bModoCobro.AL_FINAL,
];

/**
 * Lee el JSON `Tenant.modalidadesCobroB2b` como arreglo de modalidades conocidas, sin duplicados y en orden estable.
 * Un valor desconocido o un JSON que no es arreglo se ignora (no se inventa nada): quien necesite "al menos una" valida aparte.
 */
export function normalizarModalidades(raw: unknown): PedidoB2bModoCobro[] {
  if (!Array.isArray(raw)) return [];
  return MODALIDADES_COBRO.filter((m) => raw.includes(m));
}

/** 400 si no queda ninguna modalidad activa. Devuelve la lista normalizada. */
export function validarModalidadesActivas(raw: unknown): PedidoB2bModoCobro[] {
  const activas = normalizarModalidades(raw);
  if (activas.length === 0) {
    throw new BadRequestException(
      'Debe quedar activa al menos una modalidad de cobro',
    );
  }
  return activas;
}

/**
 * Valida la modalidad de un cliente B2B al crearlo o editarlo.
 *  - Obligatoria: null/undefined → 400.
 *  - Debe estar activa en el negocio, salvo que sea exactamente la que el cliente ya tiene guardada (`actual`): conservar una
 *    modalidad que se desactivó después es válido; elegir OTRA inactiva no.
 */
export function validarModalidadCliente(
  modalidad: unknown,
  activas: readonly PedidoB2bModoCobro[],
  actual?: PedidoB2bModoCobro | null,
): PedidoB2bModoCobro {
  if (modalidad === null || modalidad === undefined || modalidad === '') {
    throw new BadRequestException('La modalidad de pago es obligatoria');
  }
  if (!MODALIDADES_COBRO.includes(modalidad as PedidoB2bModoCobro)) {
    throw new BadRequestException('La modalidad de pago no es válida');
  }
  const m = modalidad as PedidoB2bModoCobro;
  if (!activas.includes(m) && m !== actual) {
    throw new BadRequestException(
      `La modalidad «${ETIQUETA_MODALIDAD[m]}» no está activa: actívala en Ajustes → Pagos`,
    );
  }
  return m;
}
