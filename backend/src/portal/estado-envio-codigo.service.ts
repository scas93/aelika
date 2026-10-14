import { Inject, Injectable } from '@nestjs/common';
import { CODIGOS_STORE } from './codigos-store';
import type { CodigosStore } from './codigos-store';

/** Vigencia del registro de un envío de código (se guarda en Redis, no en la base). */
export const TTL_ENVIO_CODIGO_SEGUNDOS = 24 * 60 * 60;

export type EstadoEnvioCodigo = 'EN_CURSO' | 'EXITO' | 'FALLO';

export interface RegistroEnvioCodigo {
  /** Negocio al que pertenece el envío (el callback solo lo ve el mismo negocio). */
  tenantId: string;
  estado: EstadoEnvioCodigo;
  /** Solo en FALLO: razón corta, ya saneada. Nunca lleva teléfono ni código. */
  motivo?: string;
  creadoAt: string;
  actualizadoAt: string;
}

export const claveEnvioCodigo = (correlacionId: string) =>
  `portal:envio:${correlacionId}`;

/**
 * Registro del resultado del envío de un código de acceso por WhatsApp. Es propio del portal: NO usa ReglaEnvioLog (esa
 * tabla exige un cliente, cuenta para el candado de marketing y es de las reglas de pedidos). Guarda solo
 * { negocio, estado, motivo } con TTL de 24 h: sin teléfono ni código.
 */
@Injectable()
export class EstadoEnvioCodigoService {
  constructor(@Inject(CODIGOS_STORE) private readonly store: CodigosStore) {}

  /** Antes del POST a Botpress: el callback podría llegar de inmediato. */
  async registrar(correlacionId: string, tenantId: string): Promise<void> {
    const ahora = new Date().toISOString();
    const registro: RegistroEnvioCodigo = {
      tenantId,
      estado: 'EN_CURSO',
      creadoAt: ahora,
      actualizadoAt: ahora,
    };
    await this.store.escribir(
      claveEnvioCodigo(correlacionId),
      JSON.stringify(registro),
      TTL_ENVIO_CODIGO_SEGUNDOS,
    );
  }

  async leer(correlacionId: string): Promise<RegistroEnvioCodigo | null> {
    const crudo = await this.store.leer(claveEnvioCodigo(correlacionId));
    return crudo ? (JSON.parse(crudo) as RegistroEnvioCodigo) : null;
  }

  /**
   * Cierra un envío (EN_CURSO → EXITO | FALLO). Un estado terminal no cambia (callback repetido o tardío = no-op).
   * `tenantId` debe coincidir: un id de otro negocio es indistinguible de uno inexistente (null).
   * Devuelve el registro vigente, o null si no existe / es de otro negocio / venció.
   */
  async cerrar(
    correlacionId: string,
    tenantId: string,
    estado: 'EXITO' | 'FALLO',
    motivo?: string,
  ): Promise<{ registro: RegistroEnvioCodigo; cambio: boolean } | null> {
    const actual = await this.leer(correlacionId);
    if (!actual || actual.tenantId !== tenantId) return null;
    if (actual.estado !== 'EN_CURSO')
      return { registro: actual, cambio: false };
    const nuevo: RegistroEnvioCodigo = {
      ...actual,
      estado,
      ...(motivo ? { motivo } : {}),
      actualizadoAt: new Date().toISOString(),
    };
    await this.store.escribir(
      claveEnvioCodigo(correlacionId),
      JSON.stringify(nuevo),
      TTL_ENVIO_CODIGO_SEGUNDOS,
    );
    return { registro: nuevo, cambio: true };
  }
}

/**
 * Sanea un texto libre que viene de fuera (Botpress) antes de escribirlo en el registro del servidor: una sola línea,
 * máximo 200 caracteres y sin secuencias de 6 o más dígitos (podrían ser el código o un teléfono).
 */
export function sanearMotivo(
  crudo: string | undefined | null,
): string | undefined {
  if (!crudo) return undefined;
  const limpio = crudo
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\d{6,}/g, '***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return limpio || undefined;
}
