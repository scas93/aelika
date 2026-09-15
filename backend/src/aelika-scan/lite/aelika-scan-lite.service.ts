import {
  GatewayTimeoutException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleMapsBusquedaError,
  GoogleMapsDetallesError,
  GoogleMapsScanService,
  NegocioAResolver,
  NegocioNoEncontradoError,
} from '../integrations/google-maps';
import { SitioWebScanService } from '../integrations/sitio-web';
import { InstagramScanService } from '../integrations/instagram';
import { FacebookScanService } from '../integrations/facebook';
import { FuentesNap, NapScanService } from '../integrations/nap';
import { calcularScoreEscaneo } from '../scoring/scoring';
import { DatosEscaneo } from '../scoring/types';
import { EscanearLiteDto } from './dto/escanear-lite.dto';

// 60s por default — configurable sin otro prompt (ver el prompt de este
// endpoint): las integraciones en paralelo pueden tardar (Instagram ~17s,
// PageSpeed en frío hasta ~30s, Outscraper con 300 reseñas tampoco es
// instantáneo), así que este valor se ajusta con datos reales de
// producción vía variable de entorno, no hardcodeado.
const TIMEOUT_MS_DEFAULT = 60_000;

function mensajeDeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Plan de qué hacer con un canal opcional (Sitio web/Instagram/Facebook)
// antes de llamar nada — decide la regla (3/4) o si de plano hay que llamar
// la integración. 'contradiccion' solo aplica a 'llamar': URL presente +
// ...ConfirmadoAusente:true a la vez (se prioriza la URL, se declara la
// contradicción como advertencia).
type PlanCanal =
  | { modo: 'llamar'; url: string; contradiccion: boolean }
  | { modo: 'ausente' }
  | { modo: 'omitir' };

function planCanal(
  url: string | undefined,
  confirmadoAusente: boolean | undefined,
): PlanCanal {
  if (url) {
    return { modo: 'llamar', url, contradiccion: Boolean(confirmadoAusente) };
  }
  if (confirmadoAusente) {
    return { modo: 'ausente' };
  }
  return { modo: 'omitir' };
}

type PlanMaps =
  | { modo: 'llamar'; negocio: NegocioAResolver; contradiccion: boolean }
  | { modo: 'ausente' }
  | { modo: 'omitir' };

function planMaps(dto: EscanearLiteDto): PlanMaps {
  // mapsConfirmadoAusente gana sobre todo lo demás relacionado a Maps —
  // salvo que venga placeId, que es la propia contradicción (un ID exacto
  // no es compatible con "sé que no existe").
  if (dto.mapsConfirmadoAusente) {
    if (dto.placeId) {
      return {
        modo: 'llamar',
        negocio: { placeId: dto.placeId },
        contradiccion: true,
      };
    }
    return { modo: 'ausente' };
  }
  // googleMapsSearch:false solo evita el Text Search (nombre+ciudad) — un
  // placeId directo no tiene ambigüedad que evitar, así que la bandera se
  // ignora si viene placeId.
  if (dto.googleMapsSearch === false && !dto.placeId) {
    return { modo: 'omitir' };
  }
  const negocio: NegocioAResolver = dto.placeId
    ? { placeId: dto.placeId }
    : { nombre: dto.nombreNegocio, ciudad: dto.ciudad! };
  return { modo: 'llamar', negocio, contradiccion: false };
}

@Injectable()
export class AelikaScanLiteService {
  private readonly logger = new Logger(AelikaScanLiteService.name);

  constructor(
    private readonly googleMapsScanService: GoogleMapsScanService,
    private readonly sitioWebScanService: SitioWebScanService,
    private readonly instagramScanService: InstagramScanService,
    private readonly facebookScanService: FacebookScanService,
    private readonly napScanService: NapScanService,
    private readonly configService: ConfigService,
  ) {}

  async escanear(dto: EscanearLiteDto) {
    const timeoutMs = this.timeoutMs();
    let timeout: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () =>
          reject(
            new GatewayTimeoutException(
              `El escaneo excedió el límite de ${timeoutMs}ms`,
            ),
          ),
        timeoutMs,
      );
    });

    try {
      return await Promise.race([this.ejecutarEscaneo(dto), timeoutPromise]);
    } finally {
      clearTimeout(timeout!);
    }
  }

  private timeoutMs(): number {
    const valor = Number(
      this.configService.get<string>('AELIKA_SCAN_LITE_TIMEOUT_MS'),
    );
    return Number.isFinite(valor) && valor > 0 ? valor : TIMEOUT_MS_DEFAULT;
  }

  private async ejecutarEscaneo(dto: EscanearLiteDto) {
    const planMapsResultado = planMaps(dto);
    const planSitioWeb = planCanal(
      dto.sitioWebUrl,
      dto.sitioWebConfirmadoAusente,
    );
    const planInstagram = planCanal(
      dto.instagramUrl,
      dto.instagramConfirmadoAusente,
    );
    const planFacebook = planCanal(
      dto.facebookUrl,
      dto.facebookConfirmadoAusente,
    );

    const advertencias: string[] = [];
    const datos: DatosEscaneo = {};
    const fuentesNap: FuentesNap = {};

    if (
      planMapsResultado.modo === 'llamar' &&
      planMapsResultado.contradiccion
    ) {
      advertencias.push(
        'Google Maps: se mandó placeId junto con mapsConfirmadoAusente:true — contradicción, se priorizó el placeId e ignoró la bandera.',
      );
    }
    if (planSitioWeb.modo === 'llamar' && planSitioWeb.contradiccion) {
      advertencias.push(
        'Sitio web: se mandó sitioWebUrl junto con sitioWebConfirmadoAusente:true — contradicción, se priorizó la URL e ignoró la bandera.',
      );
    }
    if (planInstagram.modo === 'llamar' && planInstagram.contradiccion) {
      advertencias.push(
        'Instagram: se mandó instagramUrl junto con instagramConfirmadoAusente:true — contradicción, se priorizó la URL e ignoró la bandera.',
      );
    }
    if (planFacebook.modo === 'llamar' && planFacebook.contradiccion) {
      advertencias.push(
        'Facebook: se mandó facebookUrl junto con facebookConfirmadoAusente:true — contradicción, se priorizó la URL e ignoró la bandera.',
      );
    }

    // Solo se llaman las integraciones de los canales en modo 'llamar' — el
    // resto (regla 3 'ausente' o regla 4 'omitir') se resuelve sin red,
    // antes de este Promise.allSettled. Google Maps sigue corriendo en
    // paralelo con las otras 3 cuando aplica, no antes.
    const [
      mapsResultado,
      sitioWebResultado,
      instagramResultado,
      facebookResultado,
    ] = await Promise.allSettled([
      planMapsResultado.modo === 'llamar'
        ? this.googleMapsScanService.escanear(planMapsResultado.negocio)
        : Promise.resolve(undefined),
      planSitioWeb.modo === 'llamar'
        ? this.sitioWebScanService.escanear(planSitioWeb.url)
        : Promise.resolve(undefined),
      planInstagram.modo === 'llamar'
        ? this.instagramScanService.escanear(planInstagram.url)
        : Promise.resolve(undefined),
      planFacebook.modo === 'llamar'
        ? this.facebookScanService.escanear(planFacebook.url)
        : Promise.resolve(undefined),
    ]);

    // --- Google Maps ---
    if (planMapsResultado.modo === 'ausente') {
      datos.googleMaps = { tieneCanal: false };
      advertencias.push(
        'Google Maps: confirmado sin canal (mapsConfirmadoAusente) — tratado como regla 3, cuenta en 0 contra el score.',
      );
    } else if (planMapsResultado.modo === 'omitir') {
      advertencias.push(
        'Google Maps: búsqueda omitida (googleMapsSearch:false) — categoría excluida de este escaneo (regla 4).',
      );
    } else if (mapsResultado.status === 'fulfilled' && mapsResultado.value) {
      const maps = mapsResultado.value;
      datos.googleMaps = { tieneCanal: true, ...maps.googleMaps };
      fuentesNap.googleMaps = maps.nap;
      advertencias.push(...maps.advertencias);
    } else if (mapsResultado.status === 'rejected') {
      if (mapsResultado.reason instanceof NegocioNoEncontradoError) {
        // Regla 3: "negocio no encontrado" es información real del negocio,
        // no un fallo nuestro — cuenta en 0 contra el score.
        datos.googleMaps = { tieneCanal: false };
        advertencias.push(
          `Google Maps: ${mapsResultado.reason.message} — tratado como "sin canal" (regla 3), cuenta en 0 contra el score.`,
        );
      } else {
        // Regla 4: falla técnica de la API es nuestra, no del negocio.
        const detalle =
          mapsResultado.reason instanceof GoogleMapsBusquedaError ||
          mapsResultado.reason instanceof GoogleMapsDetallesError
            ? mapsResultado.reason.message
            : mensajeDeError(mapsResultado.reason);
        this.logger.error(`Google Maps falló como servicio: ${detalle}`);
        advertencias.push(
          `Google Maps: falla técnica de la API (${detalle}) — categoría omitida de este escaneo (regla 4).`,
        );
      }
    }

    // --- Sitio web / Instagram / Facebook: mismo patrón entre los tres ---
    if (planSitioWeb.modo === 'ausente') {
      datos.sitioWeb = { tieneCanal: false };
      advertencias.push(
        'Sitio web: confirmado sin canal (sitioWebConfirmadoAusente) — regla 3, cuenta en 0 contra el score.',
      );
    } else if (
      sitioWebResultado.status === 'fulfilled' &&
      sitioWebResultado.value
    ) {
      const sitioWeb = sitioWebResultado.value;
      datos.sitioWeb = sitioWeb.sitioWeb;
      fuentesNap.sitioWeb = sitioWeb.nap;
      advertencias.push(...sitioWeb.advertencias);
    } else if (sitioWebResultado.status === 'rejected') {
      advertencias.push(
        `Sitio web: falla inesperada no manejada por la integración (${mensajeDeError(sitioWebResultado.reason)}) — categoría omitida de este escaneo (regla 4).`,
      );
    }

    if (planInstagram.modo === 'ausente') {
      datos.instagram = { tieneCanal: false };
      advertencias.push(
        'Instagram: confirmado sin canal (instagramConfirmadoAusente) — regla 3, cuenta en 0 contra el score.',
      );
    } else if (
      instagramResultado.status === 'fulfilled' &&
      instagramResultado.value
    ) {
      const instagram = instagramResultado.value;
      if (instagram.instagram !== undefined) {
        datos.instagram = instagram.instagram;
      }
      fuentesNap.instagram = instagram.nap;
      advertencias.push(...instagram.advertencias);
    } else if (instagramResultado.status === 'rejected') {
      advertencias.push(
        `Instagram: falla inesperada no manejada por la integración (${mensajeDeError(instagramResultado.reason)}) — categoría omitida de este escaneo (regla 4).`,
      );
    }

    if (planFacebook.modo === 'ausente') {
      datos.facebook = { tieneCanal: false };
      advertencias.push(
        'Facebook: confirmado sin canal (facebookConfirmadoAusente) — regla 3, cuenta en 0 contra el score.',
      );
    } else if (
      facebookResultado.status === 'fulfilled' &&
      facebookResultado.value
    ) {
      const facebook = facebookResultado.value;
      if (facebook.facebook !== undefined) {
        datos.facebook = facebook.facebook;
      }
      fuentesNap.facebook = facebook.nap;
      advertencias.push(...facebook.advertencias);
    } else if (facebookResultado.status === 'rejected') {
      advertencias.push(
        `Facebook: falla inesperada no manejada por la integración (${mensajeDeError(facebookResultado.reason)}) — categoría omitida de este escaneo (regla 4).`,
      );
    }

    // Caso borde: si ninguna categoría quedó evaluable (todas omitidas —
    // regla 4 — o nunca intentadas), un score sobre 0 categorías no tiene
    // sentido, así que se declara explícito en vez de regresar algo vacío.
    // Nota: 'ausente' (regla 3) sí deja una categoría real en 0, así que
    // nunca dispara este caso por sí solo.
    if (
      !datos.googleMaps &&
      !datos.sitioWeb &&
      !datos.instagram &&
      !datos.facebook
    ) {
      throw new UnprocessableEntityException(
        'No se pudo evaluar ninguna categoría del negocio — revisa los datos enviados.',
      );
    }

    // Consistencia NAP corre después — depende de los resultados de las 4
    // anteriores, no es paralela a ellas.
    const napResultado = this.napScanService.comparar(fuentesNap);
    advertencias.push(...napResultado.advertencias);
    if (napResultado.nap !== undefined) {
      datos.nap = napResultado.nap;
    }

    const score = calcularScoreEscaneo(datos);

    return { ...score, advertencias };
  }
}
