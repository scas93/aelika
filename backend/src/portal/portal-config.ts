// Parámetros del acceso al portal del cliente B2B (Fase 4, 4b). Valores acordados en el diseño; el tope por negocio
// se puede ajustar por variable de entorno.

/** Proyecto de Railway de producción: ahí el modo "código visible" se ignora siempre. */
export const PROYECTO_PRODUCCION = 'aelika-production';

export const LIMITES = {
  codigosPorTelefonoHora: 3,
  codigosPorTelefonoDia: 10,
  codigosPorDispositivoDia: 10,
  codigosPorIpDia: 30,
  topeDiarioNegocioDefault: 300,
  intentosPorCodigo: 5,
  vigenciaCodigoSegundos: 10 * 60,
} as const;

export const SESION_DIAS = 90;
export const SESION_MS = SESION_DIAS * 24 * 60 * 60 * 1000;
export const DISPOSITIVO_MS = 365 * 24 * 60 * 60 * 1000;

export function topeDiarioNegocio(): number {
  const n = Number(process.env.PORTAL_TOPE_DIARIO_NEGOCIO);
  return Number.isFinite(n) && n > 0 ? n : LIMITES.topeDiarioNegocioDefault;
}

/**
 * "Código visible": solo para pruebas. Con PORTAL_CODIGO_EN_LOG=true el código se escribe en el registro del
 * servidor (nunca en la respuesta HTTP). Se ignora SIEMPRE en el proyecto de producción de Railway, sin importar la
 * variable. Se evalúa en cada llamada.
 */
export function codigoVisibleActivo(): boolean {
  return (
    process.env.PORTAL_CODIGO_EN_LOG === 'true' &&
    process.env.RAILWAY_PROJECT_NAME !== PROYECTO_PRODUCCION
  );
}

/** Texto único de la respuesta a "pedir código" (exista o no el cliente). */
export const MENSAJE_CODIGO_SOLICITADO =
  'Si tu número está dado de alta, recibirás un código por WhatsApp. Si no te llega en unos minutos, contáctanos';
