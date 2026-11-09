import { BadRequestException } from '@nestjs/common';

/** Máximo de direcciones de correo del resumen semanal de un negocio de mayoreo. */
export const MAX_CORREOS_RESUMEN = 10;
export const MAX_NOMBRE_REMITENTE = 60;
const MAX_LARGO_CORREO = 254;

// Sencilla a propósito: una sola arroba, dominio con punto, sin espacios, comas ni ángulos (que permitirían inyectar otro destinatario
// o un nombre en el campo «to»). La validación definitiva es la de Resend.
const CORREO = /^[^\s@,;<>()"'\\]+@[^\s@,;<>()"'\\]+\.[^\s@,;<>()"'\\]{2,}$/;
// Sin saltos de línea ni caracteres de control (inyección de encabezados) ni ángulos/comillas que rompan el `from`.
// eslint-disable-next-line no-control-regex
const NOMBRE_INVALIDO = /[\u0000-\u001f\u007f<>"\\]/;

export interface ConfigCorreoResumen {
  nombreRemitente: string;
  correos: string[];
}

/** Dirección de correo → forma de guardado (recortada y en minúsculas); lanza 400 si no es válida. */
export function normalizarCorreo(crudo: unknown): string {
  const texto = typeof crudo === 'string' ? crudo.trim().toLowerCase() : '';
  if (!texto || texto.length > MAX_LARGO_CORREO || !CORREO.test(texto)) {
    throw new BadRequestException(
      `«${typeof crudo === 'string' ? crudo.trim().slice(0, 60) : ''}» no es una dirección de correo válida`,
    );
  }
  return texto;
}

/**
 * ÚNICO lugar donde se valida el `config` de un canal CORREO de MAYOREO (alta y edición). Devuelve la forma canónica
 * `{ nombreRemitente, correos }`; cualquier otra llave se descarta. Acepta de 0 a 10 direcciones (una lista vacía solo es válida
 * mientras el canal esté inactivo: esa regla es del servicio), sin repetidos. El CORREO de menudeo y hotel NO pasa por aquí.
 */
export function validarConfigCorreoResumen(
  config: unknown,
): ConfigCorreoResumen {
  const c = (config ?? {}) as { nombreRemitente?: unknown; correos?: unknown };
  const nombreRemitente =
    typeof c.nombreRemitente === 'string' ? c.nombreRemitente.trim() : '';
  if (!nombreRemitente)
    throw new BadRequestException(
      'El canal de correo necesita el nombre del remitente',
    );
  if (nombreRemitente.length > MAX_NOMBRE_REMITENTE) {
    throw new BadRequestException(
      `El nombre del remitente no puede pasar de ${MAX_NOMBRE_REMITENTE} caracteres`,
    );
  }
  if (NOMBRE_INVALIDO.test(nombreRemitente)) {
    throw new BadRequestException(
      'El nombre del remitente tiene caracteres no permitidos',
    );
  }
  if (!Array.isArray(c.correos))
    throw new BadRequestException(
      'El canal de correo necesita la lista de direcciones',
    );
  if (c.correos.length > MAX_CORREOS_RESUMEN)
    throw new BadRequestException(
      `Máximo ${MAX_CORREOS_RESUMEN} direcciones de correo`,
    );
  const vistos = new Set<string>();
  const correos = c.correos.map((raw) => {
    const correo = normalizarCorreo(raw);
    if (vistos.has(correo))
      throw new BadRequestException(`La dirección ${correo} está repetida`);
    vistos.add(correo);
    return correo;
  });
  return { nombreRemitente, correos };
}

/** Direcciones guardadas en el `config` de un canal CORREO de mayoreo (lectura tolerante: filas viejas sin lista dan []). */
export function correosDeConfig(config: unknown): string[] {
  const lista = (config as { correos?: unknown } | null)?.correos;
  return Array.isArray(lista)
    ? lista.filter((c): c is string => typeof c === 'string' && c.length > 0)
    : [];
}
