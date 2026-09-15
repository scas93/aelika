import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResultadoInstagramScan } from './instagram-scan.types';

const APIFY_RUN_SYNC_URL =
  'https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items';
// Confirmado contra la API real (verificación manual de este prompt): un
// run del actor tarda entre ~15 y ~30s — no es un lookup rápido, mismo tipo
// de situación que PageSpeed Insights en la integración de Sitio web.
const APIFY_TIMEOUT_MS = 60_000;
const VENTANA_POSTS_RECIENTES_DIAS = 30;
const RESULTS_LIMIT = 20;

interface ApifyPost {
  type?: string;
  productType?: string;
  timestamp?: string;
}

interface ApifyProfile {
  fullName?: string;
  private?: boolean;
  isBusinessAccount?: boolean;
  businessCategoryName?: string;
  externalUrl?: string;
  externalUrls?: unknown[];
  latestPosts?: ApifyPost[];
}

function mensajeDeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Integración de datos de Instagram para Aelika Scan (Fase 2). Llama al
 * actor de Apify `apify~instagram-scraper` (mismo prototipo probado en
 * Bruno) y arma el resultado en el shape que espera el motor de scoring de
 * la Fase 1. A diferencia de Google Maps y Sitio web, puede regresar
 * `instagram: undefined` (regla 4) cuando Apify falla como servicio — ver
 * ResultadoInstagramScan.
 *
 * Hallazgos de la verificación manual (contra
 * instagram.com/haciendalaprovidenciaoficial) que definen qué checks son
 * viables con este actor, sin llamadas adicionales costosas:
 * - SÍ viables: cuentaProfesional (`isBusinessAccount`), bio (categoría +
 *   link — el contacto nunca se puede confirmar, ver comentario abajo),
 *   frecuencia de publicación y % Reels (`latestPosts[].timestamp`/`type`/
 *   `productType`, incluidos en `resultsType: "details"` sin pedir nada
 *   aparte).
 * - NO viables (regla 5, excluidos siempre): "Contenido sin marca de
 *   agua/reposteo" (ningún campo lo expone), "Interacción con comentarios"
 *   (el actor trae `commentsCount` pero `latestComments` siempre viene
 *   vacío aunque haya comentarios — verlos de verdad requeriría un actor
 *   aparte, más costoso), "Catálogo conectado" (ningún campo de
 *   shopping/catálogo en la respuesta).
 */
@Injectable()
export class InstagramScanService {
  private readonly logger = new Logger(InstagramScanService.name);

  constructor(private readonly configService: ConfigService) {}

  async escanear(instagramUrl: string): Promise<ResultadoInstagramScan> {
    // Fuera del try/catch de reintentos a propósito: falta de configuración
    // es un error nuestro de despliegue, no una falla transitoria de Apify
    // — debe fallar duro de inmediato, igual que GoogleMapsScanService con
    // sus API keys, no consumirse como si fuera regla 4.
    this.apifyToken();

    const advertencias: string[] = [];
    const perfil = await this.obtenerPerfilConReintento(
      instagramUrl,
      advertencias,
    );

    if (perfil === 'FALLO_SERVICIO') {
      // Regla 4: Apify falló como servicio, no la cuenta — no es una señal
      // real del negocio, así que no debe contar ni en numerador ni
      // denominador del escaneo.
      return {
        instagram: undefined,
        nap: { nombre: null, direccion: null, telefono: null },
        advertencias,
      };
    }

    if (perfil === null || perfil.private) {
      // Regla 3: cuenta privada o perfil inexistente — señal real del
      // negocio (alcance algorítmico limitado), sí cuenta en el denominador.
      advertencias.push(
        perfil?.private
          ? 'La cuenta de Instagram es privada — tratada como "sin canal" (regla 3).'
          : 'No se encontró el perfil de Instagram — tratado como "sin canal" (regla 3).',
      );
      return {
        instagram: { tieneCanal: false },
        nap: { nombre: null, direccion: null, telefono: null },
        advertencias,
      };
    }

    return {
      instagram: {
        tieneCanal: true,
        ...this.construirInstagramInput(perfil, advertencias),
      },
      nap: { nombre: perfil.fullName ?? null, direccion: null, telefono: null },
      advertencias,
    };
  }

  /**
   * Un intento, un reintento — 'FALLO_SERVICIO' si ambos fallan (regla 4).
   * null si Apify respondió pero el perfil no existe (dataset vacío).
   */
  private async obtenerPerfilConReintento(
    url: string,
    advertencias: string[],
  ): Promise<ApifyProfile | null | 'FALLO_SERVICIO'> {
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const resultado = await this.llamarApify(url);
        return resultado;
      } catch (error) {
        this.logger.warn(
          `Instagram (${url}) — intento ${intento}: ${mensajeDeError(error)}`,
        );
      }
    }

    advertencias.push(
      `Apify no respondió tras 2 intentos para ${url} — categoría Instagram excluida de este escaneo (regla 4), no es una señal del negocio.`,
    );
    return 'FALLO_SERVICIO';
  }

  private apifyToken(): string {
    const token = this.configService.get<string>('APIFY_TOKEN');
    if (!token) {
      throw new Error('APIFY_TOKEN no está configurada en este ambiente');
    }
    return token;
  }

  private async llamarApify(
    instagramUrl: string,
  ): Promise<ApifyProfile | null> {
    const endpoint = new URL(APIFY_RUN_SYNC_URL);
    endpoint.searchParams.set('token', this.apifyToken());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), APIFY_TIMEOUT_MS);
    let respuesta: Response;
    try {
      respuesta = await fetch(endpoint.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          directUrls: [instagramUrl],
          resultsType: 'details',
          resultsLimit: RESULTS_LIMIT,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!respuesta.ok) {
      throw new Error(`HTTP ${respuesta.status}`);
    }

    const body = (await respuesta.json()) as unknown;
    if (!Array.isArray(body)) {
      throw new Error(
        'respuesta de Apify con shape inesperado (no es un array)',
      );
    }
    return (body[0] as ApifyProfile | undefined) ?? null;
  }

  private construirInstagramInput(
    perfil: ApifyProfile,
    advertencias: string[],
  ) {
    const postsRecientes = this.postsDentroDeVentana(perfil.latestPosts ?? []);
    const postsPorSemana =
      (postsRecientes.length / VENTANA_POSTS_RECIENTES_DIAS) * 7;
    const porcentajeReels =
      postsRecientes.length === 0
        ? 0
        : (postsRecientes.filter((p) => this.esReel(p)).length /
            postsRecientes.length) *
          100;

    // El actor nunca expone email/teléfono público del perfil (no existe el
    // campo en la respuesta) — este sub-signal de "Bio completa" siempre da
    // false con esta fuente, así que el check nunca alcanza Óptimo por esta
    // vía. Se declara en vez de dejarlo silencioso.
    advertencias.push(
      '"Bio completa": el sub-signal de contacto (email/teléfono público) nunca se puede confirmar con este actor de Apify — no expone ese campo. El check queda limitado a categoría + link.',
    );

    return {
      cuentaProfesional: Boolean(perfil.isBusinessAccount),
      bio: {
        categoriaPresente:
          Boolean(perfil.businessCategoryName) &&
          perfil.businessCategoryName !== 'None',
        contactoPresente: false,
        linkPresente:
          Boolean(perfil.externalUrl) ||
          Boolean(perfil.externalUrls && perfil.externalUrls.length > 0),
      },
      postsPorSemana,
      porcentajeReels,
      // Regla 5 — ver comentario de clase.
      contenidoSinMarcaAgua: { disponible: false as const },
      interaccionComentarios: { disponible: false as const },
      catalogoConectado: { disponible: false as const },
    };
  }

  private postsDentroDeVentana(posts: ApifyPost[]): ApifyPost[] {
    const ahora = Date.now();
    return posts.filter((p) => {
      if (!p.timestamp) return false;
      const fecha = new Date(p.timestamp);
      if (Number.isNaN(fecha.getTime())) return false;
      const dias = (ahora - fecha.getTime()) / (1000 * 60 * 60 * 24);
      return dias >= 0 && dias <= VENTANA_POSTS_RECIENTES_DIAS;
    });
  }

  // Confirmado contra la API real: un Reel tiene type:"Video" +
  // productType:"clips" — un video de feed normal (no reel) tiene
  // type:"Video" pero productType ausente/distinto.
  private esReel(post: ApifyPost): boolean {
    return post.type === 'Video' && post.productType === 'clips';
  }
}
