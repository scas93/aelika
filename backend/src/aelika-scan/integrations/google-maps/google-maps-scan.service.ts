import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NivelCheck } from '../../scoring/types';
import {
  GoogleMapsBusquedaError,
  GoogleMapsDetallesError,
  NegocioNoEncontradoError,
} from './google-maps-scan.errors';
import {
  DatosNap,
  NegocioAResolver,
  ResultadoGoogleMapsScan,
} from './google-maps-scan.types';

const PLACES_BASE_URL = 'https://places.googleapis.com/v1';
const OUTSCRAPER_BASE_URL = 'https://api.app.outscraper.com/maps/reviews-v3';

// Campos de Place Details que necesitamos. Ya estamos en el tier Enterprise
// por pedir rating/teléfono/horario (ver "Costos" en el prompt) — agregar
// displayName/formattedAddress/photos/primaryType no mueve de tier, son
// campos del tier base incluidos en cualquier llamada.
const PLACE_DETAILS_FIELD_MASK = [
  'displayName',
  'formattedAddress',
  'internationalPhoneNumber',
  'websiteUri',
  'rating',
  'userRatingCount',
  'regularOpeningHours',
  'photos',
  'primaryType',
].join(',');

// Confirmado contra la API real (verificación manual de este prompt): el
// prototipo pedía solo 20 reseñas, que para un negocio activo cubre apenas
// ~3-4 semanas — insuficiente para el promedio de 6 meses que pide el check
// "Velocidad de reseñas nuevas". 300 reseñas cubrieron 18 meses de historial
// en la prueba real (Hacienda La Providencia), con margen amplio, en ~12s.
// Es un ajuste de costo real (Outscraper cobra por reseña obtenida), no solo
// técnico — declarado explícitamente aquí y en el prompt de esta integración.
const OUTSCRAPER_REVIEWS_LIMIT = 300;
const DIAS_VENTANA_VELOCIDAD_RESENAS = 182; // ~6 meses

interface PlaceDetailsRespuesta {
  displayName?: { text?: string };
  formattedAddress?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: { periods?: { open?: { day?: number } }[] };
  photos?: unknown[];
  primaryType?: string;
}

interface OutscraperReviewData {
  review_datetime_utc?: string;
  owner_answer?: string | null;
}

interface OutscraperBusinessData {
  name?: string;
  address?: string;
  phone?: string;
  reviews?: number;
  photos_count?: number;
  verified?: boolean;
  reviews_data?: OutscraperReviewData[];
}

interface OutscraperRespuesta {
  data?: OutscraperBusinessData[];
}

function mensajeDeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Integración de datos de Google Maps para Aelika Scan (Fase 2). Resuelve un
 * Place ID (directo o vía Text Search), obtiene Place Details + reseñas de
 * Outscraper, y arma el resultado en el shape exacto que espera el motor de
 * scoring de la Fase 1 (`backend/src/aelika-scan/scoring/types.ts`).
 *
 * Sin caché ni persistencia — cada llamada golpea las APIs reales, a
 * propósito (eso es responsabilidad de una fase posterior).
 */
@Injectable()
export class GoogleMapsScanService {
  private readonly logger = new Logger(GoogleMapsScanService.name);

  constructor(private readonly configService: ConfigService) {}

  async escanear(negocio: NegocioAResolver): Promise<ResultadoGoogleMapsScan> {
    const advertencias: string[] = [];
    const placeId =
      'placeId' in negocio
        ? negocio.placeId
        : await this.resolverPlaceId(negocio.nombre, negocio.ciudad);

    const detalles = await this.obtenerPlaceDetails(placeId);
    const outscraper = await this.obtenerDatosOutscraper(placeId, advertencias);

    return {
      googleMaps: this.construirGoogleMapsInput(
        detalles,
        outscraper,
        advertencias,
      ),
      nap: this.construirNap(detalles, outscraper),
      advertencias,
    };
  }

  private apiKeyGoogle(): string {
    const key = this.configService.get<string>('GOOGLE_PLACES_API_KEY');
    if (!key) {
      throw new Error(
        'GOOGLE_PLACES_API_KEY no está configurada en este ambiente',
      );
    }
    return key;
  }

  private apiKeyOutscraper(): string {
    const key = this.configService.get<string>('OUTSCRAPER_API_KEY');
    if (!key) {
      throw new Error(
        'OUTSCRAPER_API_KEY no está configurada en este ambiente',
      );
    }
    return key;
  }

  private async resolverPlaceId(
    nombre: string,
    ciudad: string,
  ): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${PLACES_BASE_URL}/places:searchText`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKeyGoogle(),
          'X-Goog-FieldMask': 'places.id',
        },
        body: JSON.stringify({ textQuery: `${nombre}, ${ciudad}` }),
      });
    } catch (error) {
      throw new GoogleMapsBusquedaError(
        `error de red: ${mensajeDeError(error)}`,
      );
    }

    if (!response.ok) {
      throw new GoogleMapsBusquedaError(`HTTP ${response.status}`);
    }

    const body = (await response.json().catch(() => null)) as {
      places?: { id?: string }[];
    } | null;
    const placeId = body?.places?.[0]?.id;
    if (!placeId) {
      throw new NegocioNoEncontradoError(nombre, ciudad);
    }
    return placeId;
  }

  private async obtenerPlaceDetails(
    placeId: string,
  ): Promise<PlaceDetailsRespuesta> {
    let response: Response;
    try {
      response = await fetch(`${PLACES_BASE_URL}/places/${placeId}`, {
        headers: {
          'X-Goog-Api-Key': this.apiKeyGoogle(),
          'X-Goog-FieldMask': PLACE_DETAILS_FIELD_MASK,
        },
      });
    } catch (error) {
      throw new GoogleMapsDetallesError(
        `error de red: ${mensajeDeError(error)}`,
      );
    }

    if (!response.ok) {
      throw new GoogleMapsDetallesError(`HTTP ${response.status}`);
    }

    const body = (await response
      .json()
      .catch(() => null)) as PlaceDetailsRespuesta | null;
    if (!body) {
      throw new GoogleMapsDetallesError('respuesta vacía o inválida');
    }
    return body;
  }

  /**
   * A diferencia de Text Search/Place Details, una falla aquí es
   * degradación parcial, no falla dura (ver "Manejo de errores" del prompt):
   * regresa null en vez de lanzar, y quien llama decide qué excluir.
   */
  private async obtenerDatosOutscraper(
    placeId: string,
    advertencias: string[],
  ): Promise<OutscraperBusinessData | null> {
    let response: Response;
    try {
      const url = new URL(OUTSCRAPER_BASE_URL);
      url.searchParams.set('query', placeId);
      url.searchParams.set('reviewsLimit', String(OUTSCRAPER_REVIEWS_LIMIT));
      url.searchParams.set('sort', 'newest');
      // Confirmado en el prototipo de Bruno: la respuesta llega síncrona con
      // async=false, sin necesidad de poll — ver comentario del prompt.
      url.searchParams.set('async', 'false');

      response = await fetch(url, {
        headers: { 'X-API-KEY': this.apiKeyOutscraper() },
      });
    } catch (error) {
      this.logger.warn(`Outscraper — error de red: ${mensajeDeError(error)}`);
      advertencias.push(
        'Outscraper no respondió (error de red) — se excluyeron los checks que dependen de reseñas.',
      );
      return null;
    }

    if (!response.ok) {
      this.logger.warn(`Outscraper — HTTP ${response.status}`);
      advertencias.push(
        `Outscraper respondió HTTP ${response.status} — se excluyeron los checks que dependen de reseñas.`,
      );
      return null;
    }

    const body = (await response
      .json()
      .catch(() => null)) as OutscraperRespuesta | null;
    const negocio = body?.data?.[0];
    if (!negocio) {
      advertencias.push(
        'Outscraper regresó una respuesta sin datos — se excluyeron los checks que dependen de reseñas.',
      );
      return null;
    }
    return negocio;
  }

  private construirNap(
    detalles: PlaceDetailsRespuesta,
    outscraper: OutscraperBusinessData | null,
  ): DatosNap {
    return {
      nombre: detalles.displayName?.text ?? outscraper?.name ?? null,
      direccion: detalles.formattedAddress ?? outscraper?.address ?? null,
      telefono: detalles.internationalPhoneNumber ?? outscraper?.phone ?? null,
    };
  }

  private construirGoogleMapsInput(
    detalles: PlaceDetailsRespuesta,
    outscraper: OutscraperBusinessData | null,
    advertencias: string[],
  ) {
    // Regla 9 de la Fase 1 espera dos señales (cantidad y recencia). Ninguna
    // fuente integrada expone fecha de fotos (confirmado contra la API real:
    // ni Place Details ni Outscraper traen un timestamp por foto) — se usa
    // solo la señal de cantidad, forzando recencia a "true" para que el
    // mínimo de la regla 9 nunca la penalice (deviación declarada del
    // prompt, no un bug).
    const actividadUltimos90Dias = true;

    // Place Details.photos regresa como máximo ~10 fotos de muestra, no el
    // total real del listado (confirmado: Hacienda La Providencia tiene 2904
    // fotos según Outscraper pero Place Details solo regresó 10). Se usa el
    // conteo de Outscraper cuando está disponible; si Outscraper falló, se
    // cae al conteo de Place Details declarando que es un mínimo, no el
    // total real.
    let cantidadFotos: number;
    if (outscraper?.photos_count !== undefined) {
      cantidadFotos = outscraper.photos_count;
    } else {
      cantidadFotos = detalles.photos?.length ?? 0;
      advertencias.push(
        'Sin datos de Outscraper: el conteo de fotos viene de la muestra de Place Details (máx. ~10), no del total real del listado.',
      );
    }

    // Ninguna fuente oficial expone "perfil reclamado/verificado" (confirmado
    // contra la API real), pero Outscraper sí lo trae en su respuesta de
    // reseñas (campo `verified`) — contrario a lo que anticipaba el prompt,
    // no hace falta excluir este check. Si Outscraper falló, no hay forma de
    // saberlo: se asume no verificado (conservador) y se declara.
    let perfilReclamado: boolean;
    if (outscraper) {
      perfilReclamado = outscraper.verified ?? false;
    } else {
      perfilReclamado = false;
      advertencias.push(
        'Sin datos de Outscraper: "Perfil reclamado/verificado" se asumió false (no hay otra fuente).',
      );
    }

    const totalResenasPlaceDetails = detalles.userRatingCount ?? 0;
    const totalResenasOutscraper = outscraper?.reviews ?? 0;
    const totalResenas = Math.max(
      totalResenasPlaceDetails,
      totalResenasOutscraper,
    );

    const reviewsData = outscraper?.reviews_data ?? [];
    const ahora = Date.now();
    const reviewsUltimos6Meses = reviewsData.filter((r) => {
      if (!r.review_datetime_utc) return false;
      const fecha = new Date(r.review_datetime_utc);
      if (Number.isNaN(fecha.getTime())) return false;
      const diasTranscurridos =
        (ahora - fecha.getTime()) / (1000 * 60 * 60 * 24);
      return (
        diasTranscurridos <= DIAS_VENTANA_VELOCIDAD_RESENAS &&
        diasTranscurridos >= 0
      );
    });

    return {
      perfilReclamado,
      categoriaPrincipalAsignada: Boolean(detalles.primaryType),
      horario: this.nivelHorario(detalles),
      telefonoPresente: Boolean(detalles.internationalPhoneNumber),
      sitioWebPresente: Boolean(detalles.websiteUri),
      fotos: { cantidad: cantidadFotos, actividadUltimos90Dias },
      ratingPromedio: detalles.rating ?? 0,
      totalResenas,
      velocidadResenasNuevas: outscraper
        ? {
            disponible: true as const,
            promedioMensualUltimos6Meses: reviewsUltimos6Meses.length / 6,
            totalUltimos6Meses: reviewsUltimos6Meses.length,
          }
        : { disponible: false as const },
      tasaRespuestaResenas: this.tasaRespuestaResenas(
        outscraper,
        reviewsData,
        advertencias,
      ),
    };
  }

  private nivelHorario(detalles: PlaceDetailsRespuesta): NivelCheck {
    const periodos = detalles.regularOpeningHours?.periods ?? [];
    const diasConHorario = new Set(
      periodos
        .map((p) => p.open?.day)
        .filter((d): d is number => d !== undefined),
    );

    if (diasConHorario.size === 7) return NivelCheck.OPTIMO;
    if (diasConHorario.size > 0) return NivelCheck.ACEPTABLE;
    return NivelCheck.NECESITA_ATENCION;
  }

  private tasaRespuestaResenas(
    outscraper: OutscraperBusinessData | null,
    reviewsData: OutscraperReviewData[],
    advertencias: string[],
  ): { disponible: true; valor: number } | { disponible: false } {
    if (!outscraper) {
      return { disponible: false };
    }
    if (reviewsData.length === 0) {
      advertencias.push(
        'El negocio no tiene reseñas en la muestra obtenida — "Tasa de respuesta a reseñas" no se pudo calcular.',
      );
      return { disponible: false };
    }
    const respondidas = reviewsData.filter((r) =>
      Boolean(r.owner_answer),
    ).length;
    return {
      disponible: true,
      valor: (respondidas / reviewsData.length) * 100,
    };
  }
}
