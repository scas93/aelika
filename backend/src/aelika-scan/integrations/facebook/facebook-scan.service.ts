import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NivelCheck } from '../../scoring/types';
import { ResultadoFacebookScan } from './facebook-scan.types';

const PAGES_ACTOR_URL =
  'https://api.apify.com/v2/acts/apify~facebook-pages-scraper/run-sync-get-dataset-items';
const POSTS_ACTOR_URL =
  'https://api.apify.com/v2/acts/apify~facebook-posts-scraper/run-sync-get-dataset-items';
// Confirmado contra la API real (verificación manual de este prompt): la
// página tardó ~8s, los posts ~15s — dejamos margen amplio igual que en
// Instagram/PageSpeed.
const APIFY_TIMEOUT_MS = 60_000;
const POSTS_RESULTS_LIMIT = 15;

interface ApifyPage {
  categories?: string[];
  info?: string[];
  intro?: string;
  address?: string;
  phone?: string;
}

interface ApifyPost {
  time?: string;
  isVideo?: boolean;
  media?: { __typename?: string }[];
}

function mensajeDeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Integración de datos de Facebook para Aelika Scan (Fase 2). Combina dos
 * actores de Apify (mismo prototipo de la página probado en Bruno, más un
 * actor complementario de posts que el prototipo no cubría — ver hallazgos
 * abajo) y arma el resultado en el shape que espera el motor de scoring de
 * la Fase 1. Mismo contrato de tres estados que Instagram
 * (ResultadoFacebookScan) y misma extensión de regla 5 en `types.ts`.
 *
 * Hallazgos de la verificación manual (contra
 * facebook.com/haciendalaprovidenciaoficial) que definen qué checks son
 * viables:
 * - `apify~facebook-pages-scraper` (la página en sí) confirmado que SÍ
 *   expone `address` y `phone` estructurados (mejor de lo esperado — el
 *   prototipo solo había mostrado `address`) y `categories`/`info` para
 *   "Página completa". NO expone ningún campo de botón CTA ni de
 *   shopping/catálogo — ambos quedan permanentemente en false/excluidos.
 * - El prototipo de la página NO trae publicaciones — hizo falta un actor
 *   complementario (`apify~facebook-posts-scraper`, autorizado por el
 *   prompt), que sí expone `time` (timestamp), `isVideo` y `media[].
 *   __typename` ("Video" vs "Photo") — suficiente para recencia, presencia
 *   de video y una aproximación de "contenido nativo" (ver
 *   `esContenidoNativo`, es una aproximación declarada: el actor no expone
 *   un campo explícito de "post que solo comparte un link externo").
 * - "Made with AI": ningún campo lo expone en ninguno de los dos actores —
 *   excluido siempre (regla 5), igual que "Sitio indexado en Google" en la
 *   integración de Sitio web.
 */
@Injectable()
export class FacebookScanService {
  private readonly logger = new Logger(FacebookScanService.name);

  constructor(private readonly configService: ConfigService) {}

  async escanear(facebookUrl: string): Promise<ResultadoFacebookScan> {
    // Falla dura inmediata si falta configuración — no es una degradación
    // puntual de este escaneo, es un despliegue roto (mismo criterio que
    // GoogleMapsScanService/InstagramScanService).
    this.apifyToken();

    const advertencias: string[] = [];
    const pagina = await this.obtenerPaginaConReintento(
      facebookUrl,
      advertencias,
    );

    if (pagina === 'FALLO_SERVICIO') {
      return {
        facebook: undefined,
        nap: { nombre: null, direccion: null, telefono: null },
        advertencias,
      };
    }

    if (pagina === null) {
      advertencias.push(
        'No se encontró la página de Facebook (o fue eliminada) — tratada como "sin canal" (regla 3).',
      );
      return {
        facebook: { tieneCanal: false },
        nap: { nombre: null, direccion: null, telefono: null },
        advertencias,
      };
    }

    const posts = await this.obtenerPostsConReintento(
      facebookUrl,
      advertencias,
    );

    return {
      facebook: {
        tieneCanal: true,
        ...this.construirFacebookInput(pagina, posts),
      },
      nap: {
        nombre: null,
        direccion: pagina.address ?? null,
        telefono: pagina.phone ?? null,
      },
      advertencias,
    };
  }

  private apifyToken(): string {
    const token = this.configService.get<string>('APIFY_TOKEN');
    if (!token) {
      throw new Error('APIFY_TOKEN no está configurada en este ambiente');
    }
    return token;
  }

  private async llamarApify<T>(url: string, body: unknown): Promise<T[]> {
    const endpoint = new URL(url);
    endpoint.searchParams.set('token', this.apifyToken());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), APIFY_TIMEOUT_MS);
    let respuesta: Response;
    try {
      respuesta = await fetch(endpoint.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!respuesta.ok) {
      throw new Error(`HTTP ${respuesta.status}`);
    }

    const data = (await respuesta.json()) as unknown;
    if (!Array.isArray(data)) {
      throw new Error(
        'respuesta de Apify con shape inesperado (no es un array)',
      );
    }
    return data as T[];
  }

  /**
   * 'FALLO_SERVICIO' si Apify falla como servicio tras 2 intentos (regla 4).
   * null si Apify respondió pero la página no existe (dataset vacío,
   * regla 3).
   */
  private async obtenerPaginaConReintento(
    url: string,
    advertencias: string[],
  ): Promise<ApifyPage | null | 'FALLO_SERVICIO'> {
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const items = await this.llamarApify<ApifyPage>(PAGES_ACTOR_URL, {
          startUrls: [{ url }],
        });
        return items[0] ?? null;
      } catch (error) {
        this.logger.warn(
          `Facebook — página (${url}) — intento ${intento}: ${mensajeDeError(error)}`,
        );
      }
    }

    advertencias.push(
      `Apify no respondió tras 2 intentos para ${url} — categoría Facebook excluida de este escaneo (regla 4), no es una señal del negocio.`,
    );
    return 'FALLO_SERVICIO';
  }

  /**
   * A diferencia de la página, una falla aquí es degradación parcial, no
   * total (regla 5 en 3 checks) — la página ya existe y confirmó datos
   * válidos, así que no hay motivo para excluir la categoría completa por
   * un actor secundario.
   */
  private async obtenerPostsConReintento(
    url: string,
    advertencias: string[],
  ): Promise<ApifyPost[]> {
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const posts = await this.llamarApify<ApifyPost>(POSTS_ACTOR_URL, {
          startUrls: [{ url }],
          resultsLimit: POSTS_RESULTS_LIMIT,
        });
        if (posts.length === 0) {
          advertencias.push(
            'El actor de posts no regresó publicaciones — se excluyeron "Contenido nativo", "Presencia de Reels/video" y "Recencia".',
          );
        }
        return posts;
      } catch (error) {
        this.logger.warn(
          `Facebook — posts (${url}) — intento ${intento}: ${mensajeDeError(error)}`,
        );
      }
    }

    advertencias.push(
      'El actor de posts de Facebook falló tras 2 intentos — se excluyeron "Contenido nativo", "Presencia de Reels/video" y "Recencia" (regla 5), el resto de la categoría se evaluó con lo que la página sí trajo.',
    );
    return [];
  }

  private construirFacebookInput(pagina: ApifyPage, posts: ApifyPost[]) {
    const sinPosts = posts.length === 0;

    return {
      pagina: {
        categoriaPresente: Boolean(
          pagina.categories && pagina.categories.length > 0,
        ),
        infoPresente: Boolean(pagina.info && pagina.info.length > 0),
        // Ningún campo de botón CTA en la respuesta del actor — limitación
        // declarada, este check nunca alcanza Óptimo por esta vía.
        ctaPresente: false,
      },
      contenidoNativo: sinPosts
        ? ({ disponible: false } as const)
        : ({
            disponible: true,
            nivel: this.nivelContenidoNativo(posts),
          } as const),
      presenciaReels: sinPosts
        ? ({ disponible: false } as const)
        : ({
            disponible: true,
            nivel: this.nivelPresenciaVideo(posts),
          } as const),
      diasDesdeUltimaPublicacion: sinPosts
        ? ({ disponible: false } as const)
        : ({
            disponible: true,
            dias: this.diasDesdeUltimoPost(posts),
          } as const),
      // Ningún campo de shopping/catálogo en la respuesta del actor de la
      // página — decisión cerrada, no depende de los posts.
      catalogoConectado: { disponible: false } as const,
      // Ningún campo de "Made with AI" en ninguno de los dos actores —
      // excluido siempre (ver comentario de clase).
      madeWithAi: { aplica: false } as const,
    };
  }

  private esVideo(post: ApifyPost): boolean {
    return (
      post.isVideo === true ||
      (post.media ?? []).some((m) => m.__typename === 'Video')
    );
  }

  // El actor no expone un campo explícito de "post que solo comparte un
  // link externo" — se aproxima con presencia de media propia (foto o
  // video). Un post sin ningún media (texto puro o un link compartido con
  // preview) se trata como "no nativo" para este check; es una
  // aproximación declarada, no una medición exacta de "enlace externo".
  private esContenidoNativo(post: ApifyPost): boolean {
    return (post.media ?? []).length > 0;
  }

  // Umbrales numéricos elegidos para traducir el lenguaje cualitativo del
  // prompt ("mayoría nativos / mixto / mayoría enlaces") — no vienen dados
  // como porcentaje exacto, así que se declaran aquí: >=60% nativos =
  // mayoría (Óptimo), <=40% nativos = mayoría enlaces (Necesita atención),
  // el resto es mixto (Aceptable).
  private nivelContenidoNativo(posts: ApifyPost[]): NivelCheck {
    const fraccionNativa =
      posts.filter((p) => this.esContenidoNativo(p)).length / posts.length;
    if (fraccionNativa >= 0.6) return NivelCheck.OPTIMO;
    if (fraccionNativa <= 0.4) return NivelCheck.NECESITA_ATENCION;
    return NivelCheck.ACEPTABLE;
  }

  // "Mayoría" = al menos la mitad tiene video, "algunos" = alguno pero no
  // la mayoría, "ninguno" = cero.
  private nivelPresenciaVideo(posts: ApifyPost[]): NivelCheck {
    const fraccionVideo =
      posts.filter((p) => this.esVideo(p)).length / posts.length;
    if (fraccionVideo >= 0.5) return NivelCheck.OPTIMO;
    if (fraccionVideo > 0) return NivelCheck.ACEPTABLE;
    return NivelCheck.NECESITA_ATENCION;
  }

  private diasDesdeUltimoPost(posts: ApifyPost[]): number {
    const timestamps = posts
      .map((p) => (p.time ? new Date(p.time).getTime() : NaN))
      .filter((t) => !Number.isNaN(t));
    const masReciente = Math.max(...timestamps);
    return (Date.now() - masReciente) / (1000 * 60 * 60 * 24);
  }
}
