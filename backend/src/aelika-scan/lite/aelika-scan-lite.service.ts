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
    const negocio = dto.placeId
      ? { placeId: dto.placeId }
      : { nombre: dto.nombreNegocio, ciudad: dto.ciudad! };

    // Las 4 corren en paralelo (Promise.allSettled, no Promise.all) — una
    // falla inesperada en Sitio web/Instagram/Facebook no debe tumbar a las
    // demás. Google Maps también corre acá adentro (en paralelo con las
    // otras, no antes), pero su resultado se trata aparte abajo: es
    // obligatorio y de fallo duro, sin importar qué haya pasado con el
    // resto.
    const [
      mapsResultado,
      sitioWebResultado,
      instagramResultado,
      facebookResultado,
    ] = await Promise.allSettled([
      this.googleMapsScanService.escanear(negocio),
      dto.sitioWebUrl
        ? this.sitioWebScanService.escanear(dto.sitioWebUrl)
        : Promise.resolve(undefined),
      dto.instagramUrl
        ? this.instagramScanService.escanear(dto.instagramUrl)
        : Promise.resolve(undefined),
      dto.facebookUrl
        ? this.facebookScanService.escanear(dto.facebookUrl)
        : Promise.resolve(undefined),
    ]);

    const advertencias: string[] = [];
    const datos: DatosEscaneo = {};
    const fuentesNap: FuentesNap = {};

    // Google Maps ya no es bloqueo duro (revisión de Fase 3) — se distingue
    // igual que las demás integraciones: "negocio no encontrado" es
    // información real (regla 3, cuenta en 0 pero sí entra al denominador),
    // una falla técnica de la API es nuestra (regla 4, categoría omitida
    // del todo). Ninguno de los dos casos aborta el endpoint.
    if (mapsResultado.status === 'fulfilled') {
      const maps = mapsResultado.value;
      datos.googleMaps = { tieneCanal: true, ...maps.googleMaps };
      fuentesNap.googleMaps = maps.nap;
      advertencias.push(...maps.advertencias);
    } else if (mapsResultado.reason instanceof NegocioNoEncontradoError) {
      datos.googleMaps = { tieneCanal: false };
      advertencias.push(
        `Google Maps: ${mapsResultado.reason.message} — tratado como "sin canal" (regla 3), cuenta en 0 contra el score.`,
      );
    } else {
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

    // Sitio web, Instagram y Facebook: regla 4 si no se mandó la URL (no se
    // intentó, no es lo mismo que "confirmado sin canal" — ver el prompt de
    // este endpoint) o si la integración rechazó de forma inesperada bajo
    // Promise.allSettled (no debería pasar, cada integración ya se degrada
    // internamente, pero es la red de seguridad). En ambos casos la
    // categoría simplemente se omite de `datos`, nunca se sustituye por
    // `{tieneCanal: false}`.
    // El valor resuelto ya es `undefined` cuando no se mandó la URL
    // correspondiente (esa rama del allSettled fue Promise.resolve(undefined)
    // directo, sin llamar la integración) — no hace falta repetir el chequeo
    // de dto.*Url aparte del `if (sitioWeb)`/etc. de abajo.
    if (sitioWebResultado.status === 'fulfilled' && sitioWebResultado.value) {
      const sitioWeb = sitioWebResultado.value;
      datos.sitioWeb = sitioWeb.sitioWeb;
      fuentesNap.sitioWeb = sitioWeb.nap;
      advertencias.push(...sitioWeb.advertencias);
    } else if (sitioWebResultado.status === 'rejected') {
      advertencias.push(
        `Sitio web: falla inesperada no manejada por la integración (${mensajeDeError(sitioWebResultado.reason)}) — categoría omitida de este escaneo (regla 4).`,
      );
    }

    if (instagramResultado.status === 'fulfilled' && instagramResultado.value) {
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

    if (facebookResultado.status === 'fulfilled' && facebookResultado.value) {
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

    // Caso borde: si Maps falló (cualquiera de los dos casos) y ninguno de
    // los 3 campos opcionales vino en el body tampoco, no queda ninguna
    // categoría que evaluar — un score sobre 0 categorías no tiene sentido,
    // así que se declara explícito en vez de regresar algo vacío.
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
