import { BadGatewayException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoyaltyCard } from '../../generated/prisma/client';

export interface WalletPassResultado {
  serialNumber: string;
  googleSaveUrl: string;
  applePass: string;
  shareUrl: string;
}

// Lo que regresa un PUT exitoso: WalletWallet solo confirma la actualización
// ({ serialNumber, lastUpdated, notifiedDevices, unchanged }) y NO trae
// shareUrl/googleSaveUrl/applePass — por eso todo lo demás es opcional. El
// auto-sanado (crearPase) sí regresa el WalletPassResultado completo, que
// también cabe aquí.
export type WalletPassActualizado = Pick<WalletPassResultado, 'serialNumber'> &
  Partial<Omit<WalletPassResultado, 'serialNumber'>>;

// Lo que se le entrega al frontend cuando el teléfono ya tiene pase: el link
// de su misma tarjeta (ver WalletPassService.refrescarYObtenerLink).
export interface WalletPassEntregable {
  serialNumber: string;
  shareUrl: string;
}

type ResultadoPut = { ok: true; pase: WalletPassActualizado } | { ok: false; status?: number };

export interface DatosPaseInput {
  loyaltyCard: LoyaltyCard;
  clienteNombre: string;
  tenantNombre: string;
  // Si esta tarjeta tiene al menos un LoyaltyRedemption en su historial —
  // única pieza de estado que el caller aporta más allá de lo que ya trae
  // `loyaltyCard` (contador). Con eso, calcularMensajeNotificacion deriva el
  // mensaje puramente del estado actual, nunca del evento que disparó esta
  // llamada — así un refresh/reintento/auto-sanación reproduce exactamente
  // el mismo mensaje que ya tenía el pase, y no dispara notificación. Ver
  // ese método para la tabla completa.
  yaCanjeoPremio: boolean;
}

const WALLETWALLET_BASE_URL = 'https://api.walletwallet.dev/api/passes';
// Página de «Share a Pass» de WalletWallet: `<base>/p/<serial>`, vive mientras
// exista el pase y no es de un solo uso (documentación de WalletWallet). El
// PUT no devuelve shareUrl y GET /passes/:serial tampoco, así que el link de
// una tarjeta existente se arma con el serial. Base configurable por si el
// dominio cambia.
const WALLETWALLET_SHARE_BASE_URL_DEFAULT = 'https://pass.walletwallet.dev';
const TIMEOUT_MS = 8000;
const SELLOS_TOTAL = 10;

/**
 * Interfaz hacia WalletWallet API (pases de Apple/Google Wallet) — Fase 2
 * del Módulo de Lealtad, ver CLAUDE.md. Reemplaza el stub de Fase 1: ahora
 * sí llama a la API real, con timeout explícito (`AbortSignal.timeout`)
 * porque, a diferencia de ReglaEnvioService/TelegramProvider (nadie espera
 * esa respuesta en vivo), aquí sí hay un operador parado frente a la
 * pantalla de registrar-compra/redimir-premio.
 *
 * Pase sin imágenes (plan gratis de WalletWallet, ver CLAUDE.md): el plan
 * conectado no incluye `stripURL` ("Pro-only feature" — confirmado contra la
 * API real), así que este servicio dejó de mandar
 * backgroundURL/stripURL/logoURL/iconURL por completo — nunca se degradan
 * campos individualmente según lo que el plan permita, todo el pase es
 * texto. El contador de sellos vive en `secondaryFields` (ya no en
 * `primaryFields`, junto al nombre) y la notificación de lock screen usa un
 * campo trasero dedicado (`backFields`, ver crearPase/actualizarPase) en vez
 * del `changeMessage` que antes vivía sobre el campo de Sellos.
 */
@Injectable()
export class WalletPassService {
  private readonly logger = new Logger(WalletPassService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Falla ruidosa a propósito (tira excepción) — se invoca desde el flujo
   * de alta de cliente, donde no tiene sentido devolver éxito sin
   * `shareUrl`: no hay nada útil que darle al cliente todavía. El
   * `Cliente`/`LoyaltyCard` en DB no se revierten por este fallo (ver
   * LealtadService.altaCliente) — un reintento de la alta con el mismo
   * teléfono vuelve a intentar solo la creación del pase.
   */
  async crearPase(input: DatosPaseInput): Promise<WalletPassResultado> {
    let body: Record<string, unknown>;
    let response: Response;
    try {
      body = this.construirBody(input, input.loyaltyCard.contador);
      response = await fetch(WALLETWALLET_BASE_URL, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error: any) {
      this.logger.error(
        `Error creando pase para LoyaltyCard ${input.loyaltyCard.id} (tenant=${input.loyaltyCard.tenantId}): ${error?.message ?? error}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo generar el pase de lealtad — intenta de nuevo.',
      );
    }

    if (!response.ok) {
      const detalle = await response.text().catch(() => `HTTP ${response.status}`);
      this.logger.error(
        `WalletWallet rechazó la creación del pase para LoyaltyCard ${input.loyaltyCard.id} (tenant=${input.loyaltyCard.tenantId}): ${detalle}`,
      );
      throw new ServiceUnavailableException(
        'No se pudo generar el pase de lealtad — intenta de nuevo.',
      );
    }

    return (await response.json()) as WalletPassResultado;
  }

  /**
   * `null` = la actualización (o la auto-sanación, si no había
   * `serialNumber`) falló — se loguea aquí, nunca se tira excepción: el
   * contador ya quedó guardado en DB (fuente de verdad, ver
   * LealtadService) y el endpoint debe responder éxito de todas formas,
   * mismo criterio que ReglaEnvioService.enviar() con Botpress. Sin
   * mecanismo de reintento automático (colas/jobs) en esta fase — decisión
   * consciente de mantenerlo simple por ahora.
   */
  async actualizarPase(input: DatosPaseInput): Promise<WalletPassActualizado | null> {
    if (!input.loyaltyCard.serialNumber) {
      this.logger.warn(
        `LoyaltyCard ${input.loyaltyCard.id} (tenant=${input.loyaltyCard.tenantId}) no tiene serialNumber — auto-sanación: creando el pase en vez de actualizarlo.`,
      );
      try {
        return await this.crearPase(input);
      } catch {
        // crearPase ya logueó el detalle — aquí solo se evita que la
        // excepción (pensada para el flujo de alta) se propague desde un
        // update, que nunca debe romper la respuesta.
        return null;
      }
    }

    const resultado = await this.enviarActualizacion(input, input.loyaltyCard.serialNumber);
    return resultado.ok ? resultado.pase : null;
  }

  /**
   * Alta de un teléfono que ya tiene pase (LoyaltyCard.serialNumber no nulo):
   * entrega el link de SU MISMA tarjeta, sin crear otra. El link se deriva
   * del serial (urlCompartir), así que no depende de que el PUT salga bien:
   * el PUT es best-effort (re-sincroniza nombre/contador si una actualización
   * anterior falló) y cualquier fallo suyo (4xx/5xx/429/timeout) solo queda en
   * logs, nunca bloquea la entrega.
   *
   * Excepción: 404 del PUT = WalletWallet no conoce ese serial (pase borrado
   * o cuenta distinta). Ahí el link derivado llevaría a una tarjeta que no
   * existe, así que NO se entrega y se tira un error explícito.
   */
  async refrescarYObtenerLink(input: DatosPaseInput): Promise<WalletPassEntregable> {
    const serialNumber = input.loyaltyCard.serialNumber;
    if (!serialNumber) {
      throw new ServiceUnavailableException('Esta tarjeta todavía no tiene pase de wallet.');
    }

    const resultado = await this.enviarActualizacion(input, serialNumber);
    if (!resultado.ok && resultado.status === 404) {
      throw new BadGatewayException(
        'No se encontró el pase de esta tarjeta en el wallet — avisa al negocio para que lo regeneren.',
      );
    }
    if (!resultado.ok) {
      this.logger.warn(
        `El PUT del pase ${serialNumber} (LoyaltyCard ${input.loyaltyCard.id}) falló${resultado.status ? ` con HTTP ${resultado.status}` : ''} — se entrega el link de todas formas.`,
      );
    }

    return { serialNumber, shareUrl: this.urlCompartir(serialNumber) };
  }

  /** `<base>/p/<serial>` — ver WALLETWALLET_SHARE_BASE_URL_DEFAULT. */
  urlCompartir(serialNumber: string): string {
    const base =
      this.configService.get<string>('WALLETWALLET_SHARE_BASE_URL')?.trim() || WALLETWALLET_SHARE_BASE_URL_DEFAULT;
    return `${base.replace(/\/+$/, '')}/p/${encodeURIComponent(serialNumber)}`;
  }

  /** PUT del pase. Nunca tira: devuelve `ok:false` (con el status HTTP, si hubo respuesta). */
  private async enviarActualizacion(input: DatosPaseInput, serialNumber: string): Promise<ResultadoPut> {
    const url = `${WALLETWALLET_BASE_URL}/${serialNumber}`;

    try {
      const body = this.construirBody(input, input.loyaltyCard.contador);
      const response = await fetch(url, {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        const detalle = await response.text().catch(() => `HTTP ${response.status}`);
        this.logger.error(
          `WalletWallet rechazó la actualización del pase ${serialNumber} (LoyaltyCard ${input.loyaltyCard.id}): ${detalle}`,
        );
        return { ok: false, status: response.status };
      }

      return { ok: true, pase: (await response.json()) as WalletPassActualizado };
    } catch (error: any) {
      this.logger.error(
        `Error actualizando el pase ${serialNumber} (LoyaltyCard ${input.loyaltyCard.id}): ${error?.message ?? error}`,
      );
      return { ok: false };
    }
  }

  private headers(): Record<string, string> {
    const apiKey = this.configService.get<string>('WALLETWALLET_API_KEY');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
  }

  private construirBody(input: DatosPaseInput, contador: number): Record<string, unknown> {
    return {
      barcodeValue: input.loyaltyCard.token,
      barcodeFormat: 'QR',
      logoText: input.tenantNombre,
      organizationName: input.tenantNombre,
      // Sin campo de color por tenant en el schema todavía — fijo para
      // todos por ahora, limitación conocida no bloqueante (ver
      // CLAUDE.md).
      colorPreset: 'dark',
      primaryFields: [{ label: 'Nombre', value: input.clienteNombre }],
      secondaryFields: [{ label: 'Sellos', value: `${contador}/${SELLOS_TOTAL}` }],
      // Único disparador de notificación de lock screen: WalletWallet manda
      // el push cuando este valor CAMBIA respecto al último enviado, usando
      // changeMessage como plantilla (%@ = el valor nuevo, que aquí ya es
      // el mensaje completo, no un número aislado). Por eso
      // calcularMensajeNotificacion nunca puede depender de "qué acción
      // disparó esta llamada" — solo del estado actual — o un refresh sin
      // cambios reenviaría un valor distinto al último y dispararía una
      // notificación falsa.
      backFields: [
        {
          label: 'Notifications',
          value: this.calcularMensajeNotificacion(contador, input.yaCanjeoPremio),
          changeMessage: '%@',
        },
      ],
      // sharingProhibited no se manda — su default (true, tarjeta privada)
      // ya es el comportamiento correcto.
    };
  }

  /**
   * Fuente única del mensaje de notificación — derivado solo de
   * (contador, yaCanjeoPremio), nunca del evento que provocó la llamada
   * (crear/sello/redimir/refresh). Eso es lo que hace que un
   * reintento/auto-sanación/alta repetida sin cambios reales sea
   * naturalmente un no-op: recalculan exactamente el mismo string que ya
   * tenía el pase, así que WalletWallet no ve un cambio de valor y no manda
   * push. La rama contador=0 es la única ambigua entre "nunca ha canjeado"
   * (recién creada) y "acaba de canjear" (el flujo de redimirPremio resetea
   * el contador a 0) — yaCanjeoPremio es exactamente lo que las distingue.
   */
  private calcularMensajeNotificacion(contador: number, yaCanjeoPremio: boolean): string {
    if (contador >= SELLOS_TOTAL) {
      return '¡Completaste tu tarjeta! Pide tu premio en tu próxima visita';
    }
    if (contador === 0) {
      return yaCanjeoPremio ? 'Premio canjeado. Tu tarjeta empieza de nuevo' : ' ';
    }
    return `¡Sello registrado! Llevas ${contador}/${SELLOS_TOTAL}`;
  }
}
