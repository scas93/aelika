import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  EstadoEnvioCodigoService,
  sanearMotivo,
} from './estado-envio-codigo.service';

// Mismo supuesto que ReglaEnvioService: teléfonos de 10 dígitos nacionales, Botpress/Meta piden el código de país.
const LADA_PAIS = '+52';

/** Tiempo máximo de espera al webhook de Botpress: pasado este tiempo el envío se da por fallido. */
export const TIMEOUT_ENVIO_CODIGO_MS = 10_000;

export interface DatosEnvioCodigo {
  tenantId: string;
  tenantSlug: string;
  botWebhookUrl: string | null;
  botWebhookSecret: string | null;
  plantillaNombre: string | null;
  plantillaIdioma: string | null;
  /** 10 dígitos normalizados. */
  telefono: string;
  codigo: string;
}

export type ResultadoEnvioCodigo =
  { enviado: true; correlacionId: string } | { enviado: false; motivo: string };

/**
 * Envío del código de acceso por WhatsApp (plantilla de AUTENTICACIÓN con botón de copiar código). Separado del
 * motor de reglas: no hay Regla ni Cliente, y la bitácora de reglas exige clienteId.
 *
 * Contrato del POST al webhook de Botpress (el mismo de siempre: Tenant.botWebhookUrl + x-bp-secret). Es el de
 * ReglaEnvioService más `categoria`, `negocio` y `boton`:
 *   { correlacionId, negocio, telefono: "+52…", categoria: "AUTHENTICATION",
 *     plantilla: { nombre, idioma }, variables: [codigo], boton?: { tipo: "COPIAR_CODIGO", valor: codigo } }
 * `variables` es un ARREGLO posicional (la plantilla tiene una sola variable: el código). `boton` es opcional para
 * Botpress: puede ignorarlo si su flujo no lo usa. El idioma viene del negocio; no hay valor por defecto.
 *
 * El resultado real llega por PATCH /internal/portal-codigos/:correlacionId/estado (ver PortalCodigosCallbackController).
 * El registro del envío vive en Redis (EstadoEnvioCodigoService). El código NUNCA se escribe en el registro del servidor.
 */
@Injectable()
export class EnviarCodigoAccesoService {
  private readonly logger = new Logger(EnviarCodigoAccesoService.name);

  constructor(private readonly estados: EstadoEnvioCodigoService) {}

  async enviar(d: DatosEnvioCodigo): Promise<ResultadoEnvioCodigo> {
    if (!d.botWebhookUrl)
      return {
        enviado: false,
        motivo: 'El negocio no tiene webhook de Botpress configurado',
      };
    if (!d.plantillaNombre || !d.plantillaIdioma)
      return {
        enviado: false,
        motivo: 'El negocio no tiene plantilla de código configurada',
      };

    const correlacionId = randomUUID();
    // Antes del POST: si Botpress responde por el callback de inmediato, el registro ya debe existir.
    try {
      await this.estados.registrar(correlacionId, d.tenantId);
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo registrar el envío del código (negocio=${d.tenantSlug}, correlacion=${correlacionId}): ${String(error)}`,
      );
    }

    const payload = {
      correlacionId,
      negocio: d.tenantSlug,
      telefono: `${LADA_PAIS}${d.telefono}`,
      categoria: 'AUTHENTICATION',
      plantilla: { nombre: d.plantillaNombre, idioma: d.plantillaIdioma },
      variables: [d.codigo],
      // Plantillas de autenticación: el botón "copiar código" lleva el mismo código que el cuerpo. Opcional para Botpress.
      boton: { tipo: 'COPIAR_CODIGO', valor: d.codigo },
    };

    try {
      const res = await fetch(d.botWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(d.botWebhookSecret ? { 'x-bp-secret': d.botWebhookSecret } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_ENVIO_CODIGO_MS),
      });
      if (!res.ok) {
        return this.fallo(d, correlacionId, `HTTP ${res.status}`);
      }
      return { enviado: true, correlacionId };
    } catch (error: unknown) {
      const timeout =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');
      return this.fallo(
        d,
        correlacionId,
        timeout ? 'Sin respuesta de Botpress (timeout)' : 'Error de red',
      );
    }
  }

  /** El POST falló: queda FALLO en el registro del envío y un warn para el equipo técnico (sin teléfono ni código). */
  private async fallo(
    d: DatosEnvioCodigo,
    correlacionId: string,
    motivo: string,
  ): Promise<ResultadoEnvioCodigo> {
    this.logger.warn(
      `Envío del código de acceso fallido (negocio=${d.tenantSlug}, correlacion=${correlacionId}): ${motivo}`,
    );
    await this.estados
      .cerrar(correlacionId, d.tenantId, 'FALLO', sanearMotivo(motivo))
      .catch(() => undefined);
    return { enviado: false, motivo };
  }
}
