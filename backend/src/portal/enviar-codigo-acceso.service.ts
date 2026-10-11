import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

// Mismo supuesto que ReglaEnvioService: teléfonos de 10 dígitos nacionales, Botpress/Meta piden el código de país.
const LADA_PAIS = '+52';

export interface DatosEnvioCodigo {
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
 * motor de reglas: no hay Regla ni Cliente, y la bitácora de reglas exige clienteId. Mismo contrato de webhook que
 * ReglaEnvioService (POST a Tenant.botWebhookUrl con x-bp-secret); el payload agrega `categoria: AUTHENTICATION` y el
 * botón. En la 4b solo se ejercita con un envío simulado: sin plantilla configurada NO envía.
 * El código NUNCA se escribe en el registro desde aquí.
 */
@Injectable()
export class EnviarCodigoAccesoService {
  private readonly logger = new Logger(EnviarCodigoAccesoService.name);

  async enviar(d: DatosEnvioCodigo): Promise<ResultadoEnvioCodigo> {
    if (!d.botWebhookUrl)
      return {
        enviado: false,
        motivo: 'El negocio no tiene webhook de Botpress configurado',
      };
    if (!d.plantillaNombre)
      return {
        enviado: false,
        motivo: 'El negocio no tiene plantilla de código configurada',
      };

    const correlacionId = randomUUID();
    const payload = {
      correlacionId,
      telefono: `${LADA_PAIS}${d.telefono}`,
      categoria: 'AUTHENTICATION',
      plantilla: {
        nombre: d.plantillaNombre,
        idioma: d.plantillaIdioma ?? 'es_MX',
      },
      variables: { codigo: d.codigo },
      // Plantillas de autenticación: el botón "copiar código" lleva el mismo código que el cuerpo.
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
      });
      if (!res.ok) {
        this.logger.warn(
          `Botpress rechazó el envío del código (negocio=${d.tenantSlug}, HTTP ${res.status})`,
        );
        return { enviado: false, motivo: `HTTP ${res.status}` };
      }
      return { enviado: true, correlacionId };
    } catch (error: unknown) {
      this.logger.error(
        `No se pudo contactar a Botpress para el código de acceso (negocio=${d.tenantSlug}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { enviado: false, motivo: 'Error de red' };
    }
  }
}
