import { Injectable } from '@nestjs/common';

/** Tiempo máximo de espera al webhook de Botpress (mismo valor que las reglas y el código del portal). */
export const TIMEOUT_AVISO_MS = 10_000;

export interface PeticionWebhook {
  url: string;
  secreto: string | null;
  cuerpo: unknown;
}

export type RespuestaWebhook = { ok: boolean; status: number };

/**
 * Frontera de red del aviso interno: el POST al webhook de Botpress, y nada más. Existe como clase aparte para que la harness
 * de caracterización la sustituya por un falso (ningún test hace fetch real). Lanza si la red falla o se vence el tiempo
 * (`TimeoutError`/`AbortError`); el servicio decide qué hacer con eso.
 */
@Injectable()
export class AvisoWebhookClient {
  async post(p: PeticionWebhook): Promise<RespuestaWebhook> {
    const res = await fetch(p.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(p.secreto ? { 'x-bp-secret': p.secreto } : {}),
      },
      body: JSON.stringify(p.cuerpo),
      signal: AbortSignal.timeout(TIMEOUT_AVISO_MS),
    });
    return { ok: res.ok, status: res.status };
  }
}
