import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * Códigos estructurados para los errores de negocio de Lealtad que el
 * frontend necesita distinguir sin comparar contra el texto del mensaje
 * (ver registrar-compra-tab.tsx) — primera vez que el proyecto necesita
 * esto (confirmado por auditoría: en todo el resto del backend, cada
 * excepción es un string plano). Alcance deliberadamente acotado a los 3
 * casos que hoy generan ambigüedad o la generarán si el mensaje cambia —
 * no se le puso código a la excepción de RedimirPremio (única causa
 * posible de ese 409, sin nada de qué distinguirla).
 */
export const LealtadErrorCode = {
  TOKEN_NO_ENCONTRADO: 'TOKEN_NO_ENCONTRADO',
  PREMIO_PENDIENTE: 'PREMIO_PENDIENTE',
  SELLO_YA_REGISTRADO_HOY: 'SELLO_YA_REGISTRADO_HOY',
} as const;

export type LealtadErrorCode = (typeof LealtadErrorCode)[keyof typeof LealtadErrorCode];

/**
 * NestJS solo auto-inyecta `statusCode`/`error` en el body cuando
 * `getResponse()` es un string — al pasarle un objeto (necesario para
 * meter `code`), hay que armar ese mismo shape a mano para que el body
 * final se vea idéntico al de cualquier otra excepción del proyecto, salvo
 * por el campo `code` adicional (verificado contra el filtro default de
 * Nest, ver BaseExceptionFilter.handleUnknownError).
 */
export function lealtadNotFound(message: string, code: LealtadErrorCode): NotFoundException {
  return new NotFoundException({ statusCode: 404, error: 'Not Found', message, code });
}

export function lealtadConflict(message: string, code: LealtadErrorCode): ConflictException {
  return new ConflictException({ statusCode: 409, error: 'Conflict', message, code });
}
