import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResultadoSitioWebScan } from './sitio-web-scan.types';

const FETCH_TIMEOUT_MS = 10_000;
// PageSpeed Insights corre una auditoría real de Lighthouse contra la URL,
// no es un lookup rápido — confirmado contra la API real: ~20s para
// haciendalaprovidencia.com. El timeout genérico de 10s (bueno para el
// fetch del HTML propio, Custom Search y Text Search/Place Details) lo
// cortaba en seco ("This operation was aborted") antes de que PageSpeed
// alcanzara a responder, generando un falso "PageSpeed falló" en vez del
// resultado real.
const PAGESPEED_TIMEOUT_MS = 30_000;

// Subtipos de schema.org LocalBusiness más relevantes para las verticales de
// Aelika (ver GiroNegocio en el schema de Prisma) — no es la taxonomía
// completa de schema.org (esa es un árbol profundo con decenas de subtipos),
// es un subconjunto pragmático declarado para esta fase. Extender esta lista
// es solo agregar strings, no rediseñar la detección.
const SUBTIPOS_LOCAL_BUSINESS_RECONOCIDOS = new Set([
  'LocalBusiness',
  'FoodEstablishment',
  'Restaurant',
  'CafeOrCoffeeShop',
  'Bakery',
  'BarOrPub',
  'LodgingBusiness',
  'Hotel',
  'Store',
]);

const PIXEL_PATTERNS = [
  /fbq\(/i,
  /connect\.facebook\.net\/[^"'\s]*\/fbevents\.js/i,
];
const TAG_PATTERNS = [
  /gtag\(/i,
  /googletagmanager\.com\/gtag\/js/i,
  /googletagmanager\.com\/gtm\.js/i,
];

interface PlacesLdJson {
  '@type'?: string | string[];
  name?: string;
  address?: unknown;
  telephone?: string;
  '@graph'?: PlacesLdJson[];
}

function mensajeDeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Integración de datos de Sitio web para Aelika Scan (Fase 2). Hace su
 * propio fetch del HTML (sin ejecutar JavaScript — ver limitación conocida
 * en el prompt de esta integración), y llama PageSpeed Insights y Google
 * Custom Search para los dos checks que no se pueden derivar del HTML.
 * Arma el resultado en el shape exacto que espera el motor de scoring de la
 * Fase 1 (`backend/src/aelika-scan/scoring/types.ts`).
 *
 * Sin caché ni persistencia, igual que la integración de Google Maps.
 */
@Injectable()
export class SitioWebScanService {
  private readonly logger = new Logger(SitioWebScanService.name);

  constructor(private readonly configService: ConfigService) {}

  async escanear(sitioWebUrl: string): Promise<ResultadoSitioWebScan> {
    const advertencias: string[] = [];
    const pagina = await this.obtenerPaginaConReintento(
      sitioWebUrl,
      advertencias,
    );

    if (!pagina) {
      return {
        sitioWeb: { tieneCanal: false },
        nap: { nombre: null, direccion: null, telefono: null },
        advertencias,
      };
    }

    const { html, finalUrl } = pagina;
    const ldJsonBloques = this.extraerJsonLd(html);
    const localBusiness = this.buscarLocalBusiness(ldJsonBloques);

    const pagespeed = await this.obtenerPageSpeed(finalUrl, advertencias);
    const indexadoGoogle = this.consultarIndexacion(advertencias);

    return {
      sitioWeb: {
        tieneCanal: true,
        sslActivo: finalUrl.startsWith('https://'),
        pagespeed,
        indexadoGoogle,
        datosEstructurados: localBusiness !== null,
        metaPixelInstalado: PIXEL_PATTERNS.some((p) => p.test(html)),
        googleTagInstalado: TAG_PATTERNS.some((p) => p.test(html)),
      },
      nap: this.construirNap(localBusiness),
      advertencias,
    };
  }

  /**
   * Regla 3: un sitio inalcanzable tras reintentar no es un fallo nuestro,
   * es una señal legítima — se resuelve a null (tieneCanal: false), nunca
   * lanza. Un reintento por si fue un problema transitorio (timeout, 5xx).
   */
  private async obtenerPaginaConReintento(
    url: string,
    advertencias: string[],
  ): Promise<{ html: string; finalUrl: string } | null> {
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const respuesta = await this.fetchConTimeout(url);
        if (respuesta.ok) {
          return {
            html: await respuesta.text(),
            finalUrl: respuesta.url || url,
          };
        }
        this.logger.warn(
          `Sitio web (${url}) — intento ${intento}: HTTP ${respuesta.status}`,
        );
      } catch (error) {
        this.logger.warn(
          `Sitio web (${url}) — intento ${intento}: ${mensajeDeError(error)}`,
        );
      }
    }

    advertencias.push(
      `El sitio (${url}) no cargó tras 2 intentos — tratado como "sin canal" (regla 3), no como falla de la integración.`,
    );
    return null;
  }

  private async fetchConTimeout(
    url: string,
    timeoutMs = FETCH_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private extraerJsonLd(html: string): PlacesLdJson[] {
    const bloques: PlacesLdJson[] = [];
    const regex =
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      try {
        const parsed: unknown = JSON.parse(match[1].trim());
        for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
          bloques.push(item as PlacesLdJson);
        }
      } catch {
        // JSON-LD malformado — se ignora ese bloque, no se rompe todo el escaneo.
      }
    }
    return bloques;
  }

  private buscarLocalBusiness(bloques: PlacesLdJson[]): PlacesLdJson | null {
    for (const bloque of bloques) {
      const candidatos = bloque['@graph'] ?? [bloque];
      for (const candidato of candidatos) {
        const tipos = Array.isArray(candidato['@type'])
          ? candidato['@type']
          : [candidato['@type']];
        if (
          tipos.some((t) => t && SUBTIPOS_LOCAL_BUSINESS_RECONOCIDOS.has(t))
        ) {
          return candidato;
        }
      }
    }
    return null;
  }

  private construirNap(localBusiness: PlacesLdJson | null) {
    if (!localBusiness) {
      return { nombre: null, direccion: null, telefono: null };
    }
    return {
      nombre: localBusiness.name ?? null,
      direccion: this.direccionComoTexto(localBusiness.address),
      telefono: localBusiness.telephone ?? null,
    };
  }

  // El campo `address` de schema.org puede ser un string simple o un objeto
  // PostalAddress estructurado — se arma un texto legible en el segundo caso
  // para que el shape de `nap` (string | null) sea consistente con el de la
  // integración de Google Maps.
  private direccionComoTexto(address: unknown): string | null {
    if (!address) return null;
    if (typeof address === 'string') return address;
    if (typeof address === 'object') {
      const a = address as Record<string, string | undefined>;
      const partes = [
        a.streetAddress,
        a.addressLocality,
        a.addressRegion,
        a.postalCode,
      ].filter(Boolean);
      return partes.length > 0 ? partes.join(', ') : null;
    }
    return null;
  }

  private apiKeyPageSpeed(): string | undefined {
    return (
      this.configService.get<string>('GOOGLE_PAGESPEED_API_KEY') ??
      this.configService.get<string>('GOOGLE_PLACES_API_KEY')
    );
  }

  private async obtenerPageSpeed(
    url: string,
    advertencias: string[],
  ): Promise<{ disponible: false } | { disponible: true; valor: number }> {
    const key = this.apiKeyPageSpeed();
    if (!key) {
      advertencias.push(
        'PageSpeed Insights: sin API key configurada — se excluyó el check de Velocidad.',
      );
      return { disponible: false };
    }

    try {
      const endpoint = new URL(
        'https://www.googleapis.com/pagespeedonline/v5/runPagespeed',
      );
      endpoint.searchParams.set('url', url);
      endpoint.searchParams.set('key', key);
      endpoint.searchParams.set('category', 'performance');

      const respuesta = await this.fetchConTimeout(
        endpoint.toString(),
        PAGESPEED_TIMEOUT_MS,
      );
      if (!respuesta.ok) {
        throw new Error(`HTTP ${respuesta.status}`);
      }
      const body = (await respuesta.json()) as {
        lighthouseResult?: {
          categories?: { performance?: { score?: number } };
        };
      };
      const score = body.lighthouseResult?.categories?.performance?.score;
      if (typeof score !== 'number') {
        throw new Error(
          'respuesta sin lighthouseResult.categories.performance.score',
        );
      }
      return { disponible: true, valor: score * 100 };
    } catch (error) {
      this.logger.warn(
        `PageSpeed Insights falló para ${url}: ${mensajeDeError(error)}`,
      );
      advertencias.push(
        'PageSpeed Insights falló para este escaneo — se excluyó el check de Velocidad.',
      );
      return { disponible: false };
    }
  }

  /**
   * "Sitio indexado en Google" queda excluido permanentemente (regla 5), no
   * "sin configurar todavía" — Google deprecó la opción "Search the entire
   * web" de Programmable Search Engine (confirmado en su UI: "This feature
   * is being deprecated and can no longer be enabled"). Sin ella, un motor
   * de Custom Search solo puede buscar dentro de sitios agregados a mano
   * (ej. *.aelika.com), lo cual no sirve para verificar indexación de un
   * sitio de un tercero bajo ningún setup posible — no es un problema de
   * cuota o configuración pendiente, es que la fuente de datos que el
   * prompt original proponía ya no existe. No hay llamada HTTP que hacer
   * aquí: no tiene sentido dejar código muerto para una API que nunca se va
   * a poder usar como se pensó.
   */
  private consultarIndexacion(
    advertencias: string[],
  ): { disponible: false } | { disponible: true; indexado: boolean } {
    advertencias.push(
      'Sitio indexado en Google: excluido permanentemente — Google deprecó "Search the entire web" en Programmable Search Engine, no hay forma de verificar indexación de un sitio de tercero con Custom Search.',
    );
    return { disponible: false };
  }
}
