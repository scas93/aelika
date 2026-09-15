import { ConfigService } from '@nestjs/config';
import { FacebookScanService } from './facebook-scan.service';
import { NivelCheck } from '../../scoring/types';

// Todas las pruebas mockean fetch — nunca le pegan a Apify real (ver
// "Verificación esperada" del prompt de esta integración). La llamada real
// contra facebook.com/haciendalaprovidenciaoficial fue solo la
// verificación manual puntual de este prompt, hecha aparte.

function configServiceConToken(): ConfigService {
  return {
    get: (key: string) =>
      key === 'APIFY_TOKEN' ? 'test-apify-token' : undefined,
  } as unknown as ConfigService;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function mockFetch(impl: (url: string) => Response): typeof fetch {
  return jest.fn((url: string | URL) => Promise.resolve(impl(String(url))));
}

const ahora = Date.now();
const diasAtras = (dias: number) =>
  new Date(ahora - dias * 24 * 60 * 60 * 1000).toISOString();

// Fixture basada en la respuesta real de apify~facebook-pages-scraper
// (verificación manual de este prompt) para
// facebook.com/haciendalaprovidenciaoficial.
const paginaFixture = {
  categories: ['Page', 'Event Space'],
  info: [
    'Hacienda La Providencia, Zapopan. 27,784 likes',
    '65 talking about this.',
  ],
  address: 'av rio blanco 1727, Zapopan, Mexico, 45135',
  phone: '+52 33 3833 3851',
};

// Fixture basada en apify~facebook-posts-scraper (actor complementario, el
// prototipo de la página no traía posts) — 6 de 10 con video
// (media[].__typename === "Video"), todos con media propia (nativos).
const postsFixture = [
  { time: diasAtras(4), isVideo: false, media: [{ __typename: 'Photo' }] },
  { time: diasAtras(9), isVideo: true, media: [{ __typename: 'Video' }] },
  { time: diasAtras(13), isVideo: true, media: [{ __typename: 'Video' }] },
  { time: diasAtras(18), isVideo: false, media: [{ __typename: 'Photo' }] },
  { time: diasAtras(20), isVideo: true, media: [{ __typename: 'Video' }] },
  { time: diasAtras(24), isVideo: true, media: [{ __typename: 'Video' }] },
  { time: diasAtras(27), isVideo: false, media: [{ __typename: 'Photo' }] },
  { time: diasAtras(29), isVideo: true, media: [{ __typename: 'Video' }] },
  { time: diasAtras(35), isVideo: true, media: [{ __typename: 'Video' }] },
  { time: diasAtras(40), isVideo: false, media: [{ __typename: 'Photo' }] },
];

describe('FacebookScanService', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('arma el resultado completo combinando página + posts', async () => {
    global.fetch = mockFetch((url) => {
      if (url.includes('facebook-posts-scraper'))
        return jsonResponse(postsFixture);
      return jsonResponse([paginaFixture]);
    });

    const service = new FacebookScanService(configServiceConToken());
    const resultado = await service.escanear(
      'https://www.facebook.com/haciendalaprovidenciaoficial/',
    );

    const fb = resultado.facebook as {
      tieneCanal: true;
      pagina: {
        categoriaPresente: boolean;
        infoPresente: boolean;
        ctaPresente: boolean;
      };
      contenidoNativo: { disponible: true; nivel: NivelCheck };
      presenciaReels: { disponible: true; nivel: NivelCheck };
      diasDesdeUltimaPublicacion: { disponible: true; dias: number };
      catalogoConectado: { disponible: false };
      madeWithAi: { aplica: false };
    };

    expect(fb.tieneCanal).toBe(true);
    expect(fb.pagina).toEqual({
      categoriaPresente: true,
      infoPresente: true,
      ctaPresente: false,
    });
    // 6 de 10 con video = 60% -> Óptimo.
    expect(fb.presenciaReels).toEqual({
      disponible: true,
      nivel: NivelCheck.OPTIMO,
    });
    // Todos los posts de la fixture tienen media propia -> 100% nativo -> Óptimo.
    expect(fb.contenidoNativo).toEqual({
      disponible: true,
      nivel: NivelCheck.OPTIMO,
    });
    expect(fb.diasDesdeUltimaPublicacion.disponible).toBe(true);
    expect(fb.diasDesdeUltimaPublicacion.dias).toBeCloseTo(4, 0);
    expect(fb.catalogoConectado).toEqual({ disponible: false });
    expect(fb.madeWithAi).toEqual({ aplica: false });

    expect(resultado.nap).toEqual({
      nombre: null,
      direccion: 'av rio blanco 1727, Zapopan, Mexico, 45135',
      telefono: '+52 33 3833 3851',
    });
  });

  it('regla 3: página no encontrada (dataset vacío) se trata como "sin canal"', async () => {
    global.fetch = mockFetch(() => jsonResponse([]));

    const service = new FacebookScanService(configServiceConToken());
    const resultado = await service.escanear(
      'https://www.facebook.com/no-existe/',
    );

    expect(resultado.facebook).toEqual({ tieneCanal: false });
    expect(resultado.nap).toEqual({
      nombre: null,
      direccion: null,
      telefono: null,
    });
    expect(
      resultado.advertencias.some((a) =>
        a.toLowerCase().includes('no se encontró'),
      ),
    ).toBe(true);
  });

  it('regla 4: Apify falla como servicio en la página tras reintentar — facebook queda undefined', async () => {
    const fetchMock = mockFetch(() => jsonResponse({}, false, 500));
    global.fetch = fetchMock;

    const service = new FacebookScanService(configServiceConToken());
    const resultado = await service.escanear(
      'https://www.facebook.com/haciendalaprovidenciaoficial/',
    );

    expect(resultado.facebook).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2); // un reintento, nunca llega a llamar posts
    expect(resultado.advertencias.some((a) => a.includes('regla 4'))).toBe(
      true,
    );
  });

  it('regla 5: falla del actor de posts degrada solo 3 checks, no la categoría completa', async () => {
    global.fetch = mockFetch((url) => {
      if (url.includes('facebook-posts-scraper'))
        return jsonResponse({}, false, 500);
      return jsonResponse([paginaFixture]);
    });

    const service = new FacebookScanService(configServiceConToken());
    const resultado = await service.escanear(
      'https://www.facebook.com/haciendalaprovidenciaoficial/',
    );

    const fb = resultado.facebook as {
      tieneCanal: true;
      pagina: unknown;
      contenidoNativo: unknown;
      presenciaReels: unknown;
      diasDesdeUltimaPublicacion: unknown;
    };
    expect(fb.tieneCanal).toBe(true); // la página sí existe, no se excluye la categoría
    expect(fb.contenidoNativo).toEqual({ disponible: false });
    expect(fb.presenciaReels).toEqual({ disponible: false });
    expect(fb.diasDesdeUltimaPublicacion).toEqual({ disponible: false });
    expect(
      resultado.advertencias.some((a) => a.includes('actor de posts')),
    ).toBe(true);
  });

  it('lanza si falta APIFY_TOKEN en la configuración', async () => {
    const configSinToken = { get: () => undefined } as unknown as ConfigService;
    global.fetch = mockFetch(() => jsonResponse([paginaFixture]));

    const service = new FacebookScanService(configSinToken);
    await expect(
      service.escanear(
        'https://www.facebook.com/haciendalaprovidenciaoficial/',
      ),
    ).rejects.toThrow('APIFY_TOKEN no está configurada');
  });
});
