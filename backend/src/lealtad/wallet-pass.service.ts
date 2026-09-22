import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoyaltyCard } from '../../generated/prisma/client';

export interface WalletPassResultado {
  serialNumber: string;
  googleSaveUrl: string;
  applePass: string;
  shareUrl: string;
}

export interface DatosPaseInput {
  loyaltyCard: LoyaltyCard;
  clienteNombre: string;
  tenantNombre: string;
  // Mismo campo que ya usa el storefront público (ver PublicService.getInfo)
  // — reutilizado tal cual como logoURL/iconURL, no se agregó un campo
  // nuevo a Tenant. Puede ser null (tenant sin logo subido); en ese caso no
  // se manda logoURL/iconURL en el body en vez de mandar null. Nota: un
  // tenant sin logo se queda sin ícono válido en Apple Wallet (requerido
  // para notificaciones/lock screen) — limitación conocida, no resuelta
  // aquí, ver CLAUDE.md.
  tenantLogoUrl: string | null;
  tenantSlug: string;
}

const WALLETWALLET_BASE_URL = 'https://api.walletwallet.dev/api/passes';
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
 * Fix post-Fase 2 (confirmado con un ejemplo real exportado del Pass
 * Editor de WalletWallet): los campos de imagen NO son
 * `backgroundURLPro`/`stripURLPro`/`logoURLPro` (ese "Pro" era una
 * etiqueta de plan en la documentación, no parte del nombre del campo) —
 * son `backgroundURL`/`stripURL`/`logoURL`. Tampoco aceptan una URL
 * externa: la API no descarga imágenes, hay que mandar el contenido ya
 * codificado como `data:image/<tipo>;base64,<bytes>` — ver
 * `descargarComoDataUri`. Un experimento controlado (3 llamadas variando
 * qué campos de imagen se mandaban) descartó que el problema fuera mandar
 * ambos campos juntos; era un problema de nombre de campo + formato,
 * ambos a la vez.
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
   * teléfono vuelve a intentar solo la creación del pase. Esto incluye
   * fallos al descargar las imágenes de R2 (ver construirBody) — son parte
   * de la misma operación bloqueante.
   */
  async crearPase(input: DatosPaseInput): Promise<WalletPassResultado> {
    let body: Record<string, unknown>;
    let response: Response;
    try {
      body = await this.construirBody(input, input.loyaltyCard.contador);
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
   * mismo criterio que ReglaEnvioService.enviar() con Botpress. Un fallo al
   * descargar las imágenes de R2 (ver construirBody) se trata igual que
   * cualquier otro fallo de esta operación — best-effort, nunca rompe la
   * respuesta. Sin mecanismo de reintento automático (colas/jobs) en esta
   * fase — decisión consciente de mantenerlo simple por ahora.
   */
  async actualizarPase(input: DatosPaseInput): Promise<WalletPassResultado | null> {
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

    const url = `${WALLETWALLET_BASE_URL}/${input.loyaltyCard.serialNumber}`;

    try {
      const body = await this.construirBody(input, input.loyaltyCard.contador);
      const response = await fetch(url, {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        const detalle = await response.text().catch(() => `HTTP ${response.status}`);
        this.logger.error(
          `WalletWallet rechazó la actualización del pase ${input.loyaltyCard.serialNumber} (LoyaltyCard ${input.loyaltyCard.id}): ${detalle}`,
        );
        return null;
      }

      return (await response.json()) as WalletPassResultado;
    } catch (error: any) {
      this.logger.error(
        `Error actualizando el pase ${input.loyaltyCard.serialNumber} (LoyaltyCard ${input.loyaltyCard.id}): ${error?.message ?? error}`,
      );
      return null;
    }
  }

  private headers(): Record<string, string> {
    const apiKey = this.configService.get<string>('WALLETWALLET_API_KEY');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
  }

  private async construirBody(input: DatosPaseInput, contador: number): Promise<Record<string, unknown>> {
    const r2BaseUrl = this.configService.get<string>('R2_LOYALTY_BASE_URL');
    const backgroundUrl = `${r2BaseUrl}/${input.tenantSlug}/bg_${contador}.png`;
    const stripUrl = `${r2BaseUrl}/${input.tenantSlug}/sp_${contador}.png`;

    const [backgroundDataUri, stripDataUri, logoDataUri] = await Promise.all([
      this.descargarComoDataUri(backgroundUrl),
      this.descargarComoDataUri(stripUrl),
      input.tenantLogoUrl ? this.descargarComoDataUri(input.tenantLogoUrl) : Promise.resolve(null),
    ]);

    return {
      barcodeValue: input.loyaltyCard.token,
      barcodeFormat: 'QR',
      logoText: input.tenantNombre,
      organizationName: input.tenantNombre,
      primaryFields: [
        { label: 'Nombre', value: input.clienteNombre },
        {
          label: 'Sellos',
          value: `${contador}/${SELLOS_TOTAL}`,
          changeMessage: '¡Ya llevas %@ sellos!',
        },
      ],
      backgroundURL: backgroundDataUri,
      stripURL: stripDataUri,
      // Sin campo de color por tenant en el schema todavía — fijo para
      // todos por ahora, limitación conocida no bloqueante (ver
      // CLAUDE.md).
      colorPreset: 'dark',
      // logoURL/iconURL comparten el mismo logo del tenant — un solo
      // fetch, no dos. iconURL es lo que usa Apple Wallet en
      // notificaciones/lock screen; sin logo de tenant, el pase se queda
      // sin ícono válido ahí (ver comentario en DatosPaseInput).
      ...(logoDataUri ? { logoURL: logoDataUri, iconURL: logoDataUri } : {}),
      // sharingProhibited no se manda — su default (true, tarjeta privada)
      // ya es el comportamiento correcto.
    };
  }

  /**
   * WalletWallet no descarga imágenes desde una URL — el campo espera el
   * contenido ya codificado como `data:<content-type>;base64,<bytes>`.
   * Mismo timeout que las llamadas a WalletWallet (8s): un R2 lento no
   * debe colgar la operación completa más de lo que ya tolera el resto de
   * esta clase.
   */
  private async descargarComoDataUri(url: string): Promise<string> {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`No se pudo descargar la imagen ${url}: HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  }
}
