import {
  BadGatewayException,
  GatewayTimeoutException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AelikaScanLiteService } from './aelika-scan-lite.service';
import {
  NegocioNoEncontradoError,
  GoogleMapsBusquedaError,
} from '../integrations/google-maps';
import { NapScanService } from '../integrations/nap';
import { CategoriaId, NivelCheck } from '../scoring/types';

// Mockea los 4 servicios que hacen llamadas HTTP reales (Google Maps, Sitio
// web, Instagram, Facebook) — nunca les pega de verdad (ver "Verificación
// esperada" del prompt de este endpoint). NapScanService es lógica pura sin
// llamadas externas, así que se usa la instancia real — permite verificar
// el ensamblaje de punta a punta sin mockear algo que no hace falta mockear.

function configServiceConTimeout(ms?: number): ConfigService {
  return {
    get: () => (ms !== undefined ? String(ms) : undefined),
  } as unknown as ConfigService;
}

const mapsFixture = {
  googleMaps: {
    perfilReclamado: true,
    categoriaPrincipalAsignada: true,
    horario: NivelCheck.OPTIMO,
    telefonoPresente: true,
    sitioWebPresente: true,
    fotos: { cantidad: 10, actividadUltimos90Dias: true },
    ratingPromedio: 4.5,
    totalResenas: 50,
    velocidadResenasNuevas: {
      disponible: true as const,
      promedioMensualUltimos6Meses: 2,
      totalUltimos6Meses: 12,
    },
    tasaRespuestaResenas: { disponible: true as const, valor: 80 },
  },
  nap: { nombre: 'Negocio Test', direccion: 'Calle 1', telefono: '3338000000' },
  advertencias: [],
};

const sitioWebFixture = {
  sitioWeb: {
    tieneCanal: true as const,
    sslActivo: true,
    pagespeed: { disponible: true as const, valor: 90 },
    indexadoGoogle: { disponible: false as const },
    datosEstructurados: true,
    metaPixelInstalado: true,
    googleTagInstalado: true,
  },
  nap: { nombre: 'Negocio Test', direccion: null, telefono: null },
  advertencias: ['Sitio indexado en Google: excluido permanentemente'],
};

const instagramFixture = {
  instagram: {
    tieneCanal: true as const,
    cuentaProfesional: true,
    bio: {
      categoriaPresente: true,
      contactoPresente: false,
      linkPresente: true,
    },
    postsPorSemana: 5,
    porcentajeReels: 30,
    contenidoSinMarcaAgua: { disponible: false as const },
    interaccionComentarios: { disponible: false as const },
    catalogoConectado: { disponible: false as const },
  },
  nap: { nombre: 'Negocio Test', direccion: null, telefono: null },
  advertencias: [],
};

const facebookFixture = {
  facebook: {
    tieneCanal: true as const,
    pagina: { categoriaPresente: true, infoPresente: true, ctaPresente: false },
    contenidoNativo: { disponible: true as const, nivel: NivelCheck.OPTIMO },
    presenciaReels: { disponible: true as const, nivel: NivelCheck.ACEPTABLE },
    diasDesdeUltimaPublicacion: { disponible: true as const, dias: 3 },
    catalogoConectado: { disponible: false as const },
    madeWithAi: { aplica: false as const },
  },
  nap: { nombre: 'Negocio Test', direccion: 'Calle 1', telefono: '3338000000' },
  advertencias: [],
};

function mockServices(overrides: {
  maps?: () => Promise<unknown>;
  sitioWeb?: () => Promise<unknown>;
  instagram?: () => Promise<unknown>;
  facebook?: () => Promise<unknown>;
  timeoutMs?: number;
}) {
  const googleMapsScanService = {
    escanear: jest.fn(overrides.maps ?? (() => Promise.resolve(mapsFixture))),
  };
  const sitioWebScanService = {
    escanear: jest.fn(
      overrides.sitioWeb ?? (() => Promise.resolve(sitioWebFixture)),
    ),
  };
  const instagramScanService = {
    escanear: jest.fn(
      overrides.instagram ?? (() => Promise.resolve(instagramFixture)),
    ),
  };
  const facebookScanService = {
    escanear: jest.fn(
      overrides.facebook ?? (() => Promise.resolve(facebookFixture)),
    ),
  };

  const service = new AelikaScanLiteService(
    googleMapsScanService as never,
    sitioWebScanService as never,
    instagramScanService as never,
    facebookScanService as never,
    new NapScanService(),
    configServiceConTimeout(overrides.timeoutMs),
  );

  return {
    service,
    googleMapsScanService,
    sitioWebScanService,
    instagramScanService,
    facebookScanService,
  };
}

describe('AelikaScanLiteService', () => {
  it('arma las 5 categorías cuando los 3 campos opcionales vienen llenos', async () => {
    const { service } = mockServices({});

    const resultado = await service.escanear({
      nombreNegocio: 'Negocio Test',
      ciudad: 'Zapopan',
      sitioWebUrl: 'https://ejemplo.com/',
      instagramUrl: 'https://www.instagram.com/ejemplo/',
      facebookUrl: 'https://www.facebook.com/ejemplo/',
    });

    expect(resultado.categorias.map((c) => c.categoria).sort()).toEqual(
      [
        CategoriaId.FACEBOOK,
        CategoriaId.GOOGLE_MAPS,
        CategoriaId.INSTAGRAM,
        CategoriaId.NAP,
        CategoriaId.SITIO_WEB,
      ].sort(),
    );
    // NAP: nombre consistente (Maps/Sitio web/Instagram/Facebook todos "Negocio Test"),
    // dirección consistente (Maps/Facebook "Calle 1"), teléfono consistente.
    const nap = resultado.categorias.find(
      (c) => c.categoria === CategoriaId.NAP,
    )!;
    expect(nap.checksCumplidos).toBe(3);
    expect(resultado.advertencias).toEqual(
      expect.arrayContaining([
        'Sitio indexado en Google: excluido permanentemente',
      ]),
    );
    expect(typeof resultado.scoreGlobal).toBe('number');
  });

  it('regla 4: sin instagramUrl, la integración no se llama y la categoría se omite (no {tieneCanal:false})', async () => {
    const { service, instagramScanService } = mockServices({});

    const resultado = await service.escanear({
      nombreNegocio: 'Negocio Test',
      ciudad: 'Zapopan',
      sitioWebUrl: 'https://ejemplo.com/',
      facebookUrl: 'https://www.facebook.com/ejemplo/',
    });

    expect(instagramScanService.escanear).not.toHaveBeenCalled();
    expect(
      resultado.categorias.find((c) => c.categoria === CategoriaId.INSTAGRAM),
    ).toBeUndefined();
    // El resto no se ve afectado.
    expect(
      resultado.categorias.find((c) => c.categoria === CategoriaId.SITIO_WEB),
    ).toBeDefined();
    expect(
      resultado.categorias.find((c) => c.categoria === CategoriaId.FACEBOOK),
    ).toBeDefined();
  });

  it('regla 4: una falla inesperada de una integración opcional bajo Promise.allSettled no tumba el resto', async () => {
    const { service } = mockServices({
      sitioWeb: () => Promise.reject(new Error('boom inesperado')),
    });

    const resultado = await service.escanear({
      nombreNegocio: 'Negocio Test',
      ciudad: 'Zapopan',
      sitioWebUrl: 'https://ejemplo.com/',
      instagramUrl: 'https://www.instagram.com/ejemplo/',
    });

    expect(
      resultado.categorias.find((c) => c.categoria === CategoriaId.SITIO_WEB),
    ).toBeUndefined();
    expect(
      resultado.categorias.find((c) => c.categoria === CategoriaId.INSTAGRAM),
    ).toBeDefined();
    expect(
      resultado.advertencias.some(
        (a) => a.includes('Sitio web') && a.includes('regla 4'),
      ),
    ).toBe(true);
  });

  it('Google Maps: NegocioNoEncontradoError se mapea a NotFoundException (404), sin score parcial', async () => {
    const { service } = mockServices({
      maps: () => Promise.reject(new NegocioNoEncontradoError('X', 'Y')),
    });

    await expect(
      service.escanear({ nombreNegocio: 'X', ciudad: 'Y' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('Google Maps: una falla técnica se mapea a BadGatewayException (502)', async () => {
    const { service } = mockServices({
      maps: () => Promise.reject(new GoogleMapsBusquedaError('HTTP 500')),
    });

    await expect(
      service.escanear({ nombreNegocio: 'X', ciudad: 'Y' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('timeout: si el escaneo excede el límite configurado, responde con GatewayTimeoutException en vez de colgarse', async () => {
    const { service } = mockServices({
      timeoutMs: 20,
      instagram: () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(instagramFixture), 500),
        ),
    });

    await expect(
      service.escanear({
        nombreNegocio: 'X',
        ciudad: 'Y',
        instagramUrl: 'https://www.instagram.com/ejemplo/',
      }),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('usa placeId directo sin requerir ciudad cuando se manda', async () => {
    const { service, googleMapsScanService } = mockServices({});

    await service.escanear({
      nombreNegocio: 'Negocio Test',
      placeId: 'PLACE_ID_TEST',
    });

    expect(googleMapsScanService.escanear).toHaveBeenCalledWith({
      placeId: 'PLACE_ID_TEST',
    });
  });
});
