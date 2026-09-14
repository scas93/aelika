import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResultadoSitioWebScan } from './sitio-web-scan.types';

const FETCH_TIMEOUT_MS = 10_000;

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

    const [pagespeed, indexadoGoogle] = await Promise.all([
      this.obtenerPageSpeed(finalUrl, advertencias),
      this.consultarIndexacion(finalUrl, advertencias),
    ]);

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

  private async fetchConTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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

      const respuesta = await this.fetchConTimeout(endpoint.toString());
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

  private async consultarIndexacion(
    url: string,
    advertencias: string[],
  ): Promise<{ disponible: false } | { disponible: true; indexado: boolean }> {
    const key = this.configService.get<string>('GOOGLE_CUSTOM_SEARCH_API_KEY');
    const cx = this.configService.get<string>('GOOGLE_CUSTOM_SEARCH_CX');
    if (!key || !cx) {
      advertencias.push(
        'Google Custom Search no está configurada (GOOGLE_CUSTOM_SEARCH_API_KEY/CX) — se excluyó el check de Indexación.',
      );
      return { disponible: false };
    }

    try {
      const dominio = new URL(url).hostname;
      const endpoint = new URL('https://www.googleapis.com/customsearch/v1');
      endpoint.searchParams.set('key', key);
      endpoint.searchParams.set('cx', cx);
      endpoint.searchParams.set('q', `site:${dominio}`);

      const respuesta = await this.fetchConTimeout(endpoint.toString());
      if (!respuesta.ok) {
        throw new Error(`HTTP ${respuesta.status}`);
      }
      const body = (await respuesta.json()) as { items?: unknown[] };
      return {
        disponible: true,
        indexado: Boolean(body.items && body.items.length > 0),
      };
    } catch (error) {
      this.logger.warn(
        `Custom Search falló para ${url}: ${mensajeDeError(error)}`,
      );
      advertencias.push(
        'Google Custom Search falló para este escaneo — se excluyó el check de Indexación.',
      );
      return { disponible: false };
    }
  }
}
