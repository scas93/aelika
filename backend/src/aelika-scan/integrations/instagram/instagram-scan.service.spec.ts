import { ConfigService } from '@nestjs/config';
import { InstagramScanService } from './instagram-scan.service';

// Todas las pruebas mockean fetch — nunca le pegan a Apify real (ver
// "Verificación esperada" del prompt de esta integración). La llamada real
// contra instagram.com/haciendalaprovidenciaoficial fue solo la
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

function mockFetch(impl: () => Response): typeof fetch {
  return jest.fn(() => Promise.resolve(impl()));
}

const ahora = Date.now();
const diasAtras = (dias: number) =>
  new Date(ahora - dias * 24 * 60 * 60 * 1000).toISOString();

// Fixture basada en la respuesta real de Apify (verificación manual de este
// prompt) para instagram.com/haciendalaprovidenciaoficial — cuenta de
// negocio, sin categoría configurada (el actor regresa el string "None",
// no null, cuando no hay categoría), con posts recientes y algunos Reels
// (type: "Video" + productType: "clips").
const perfilFixture = {
  fullName: 'Hacienda La Providencia',
  private: false,
  isBusinessAccount: true,
  businessCategoryName: 'None',
  externalUrl: 'http://www.haciendalaprovidencia.com/',
  externalUrls: [{ url: 'http://www.haciendalaprovidencia.com/' }],
  latestPosts: [
    { type: 'Sidecar', timestamp: diasAtras(4) },
    { type: 'Image', timestamp: diasAtras(11) },
    { type: 'Sidecar', timestamp: diasAtras(13) },
    { type: 'Video', productType: 'clips', timestamp: diasAtras(22) },
    { type: 'Video', productType: 'clips', timestamp: diasAtras(25) },
    { type: 'Video', productType: 'clips', timestamp: diasAtras(28) },
    { type: 'Sidecar', timestamp: diasAtras(38) }, // fuera de la ventana de 30 días
  ],
};

describe('InstagramScanService', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('arma el resultado completo a partir del perfil y los posts recientes', async () => {
    global.fetch = mockFetch(() => jsonResponse([perfilFixture]));

    const service = new InstagramScanService(configServiceConToken());
    const resultado = await service.escanear(
      'https://www.instagram.com/haciendalaprovidenciaoficial/',
    );

    // 6 posts dentro de los últimos 30 días (el de hace 38 días queda fuera).
    // postsPorSemana = 6 / 30 * 7 ≈ 1.4. Reels: 3 de 6 = 50%.
    const ig = resultado.instagram as {
      tieneCanal: true;
      postsPorSemana: number;
    };
    expect(ig.postsPorSemana).toBeCloseTo(1.4);
    expect(resultado.instagram).toEqual({
      tieneCanal: true,
      cuentaProfesional: true,
      bio: {
        categoriaPresente: false,
        contactoPresente: false,
        linkPresente: true,
      },
      postsPorSemana: ig.postsPorSemana,
      porcentajeReels: 50,
      contenidoSinMarcaAgua: { disponible: false },
      interaccionComentarios: { disponible: false },
      catalogoConectado: { disponible: false },
    });

    expect(resultado.nap).toEqual({
      nombre: 'Hacienda La Providencia',
      direccion: null,
      telefono: null,
    });
    expect(resultado.advertencias.some((a) => a.includes('Bio completa'))).toBe(
      true,
    );
  });

  it('"businessCategoryName: None" (string literal del actor) cuenta como categoría ausente, no presente', async () => {
    const conCategoria = {
      ...perfilFixture,
      businessCategoryName: 'Salón de eventos',
    };
    global.fetch = mockFetch(() => jsonResponse([conCategoria]));

    const service = new InstagramScanService(configServiceConToken());
    const resultado = await service.escanear(
      'https://www.instagram.com/haciendalaprovidenciaoficial/',
    );

    const ig = resultado.instagram as {
      tieneCanal: true;
      bio: { categoriaPresente: boolean };
    };
    expect(ig.bio.categoriaPresente).toBe(true);
  });

  it('type: "Video" sin productType "clips" no cuenta como Reel (video de feed normal)', async () => {
    const conVideoNormal = {
      ...perfilFixture,
      latestPosts: [
        { type: 'Video', timestamp: diasAtras(2) }, // sin productType "clips" -> no es reel
        { type: 'Video', productType: 'clips', timestamp: diasAtras(3) },
      ],
    };
    global.fetch = mockFetch(() => jsonResponse([conVideoNormal]));

    const service = new InstagramScanService(configServiceConToken());
    const resultado = await service.escanear(
      'https://www.instagram.com/haciendalaprovidenciaoficial/',
    );

    const ig = resultado.instagram as {
      tieneCanal: true;
      porcentajeReels: number;
    };
    expect(ig.porcentajeReels).toBe(50); // 1 de 2
  });

  it('regla 3: cuenta privada se trata como "sin canal"', async () => {
    global.fetch = mockFetch(() =>
      jsonResponse([{ ...perfilFixture, private: true }]),
    );

    const service = new InstagramScanService(configServiceConToken());
    const resultado = await service.escanear(
      'https://www.instagram.com/privada/',
    );

    expect(resultado.instagram).toEqual({ tieneCanal: false });
    expect(resultado.nap).toEqual({
      nombre: null,
      direccion: null,
      telefono: null,
    });
    expect(resultado.advertencias.some((a) => a.includes('privada'))).toBe(
      true,
    );
  });

  it('regla 3: perfil no encontrado (dataset vacío) se trata como "sin canal"', async () => {
    global.fetch = mockFetch(() => jsonResponse([]));

    const service = new InstagramScanService(configServiceConToken());
    const resultado = await service.escanear(
      'https://www.instagram.com/no-existe/',
    );

    expect(resultado.instagram).toEqual({ tieneCanal: false });
    expect(
      resultado.advertencias.some(
        (a) =>
          a.includes('no se encontró'.toLowerCase()) ||
          a.toLowerCase().includes('no se encontró'),
      ),
    ).toBe(true);
  });

  it('regla 4: Apify falla como servicio tras reintentar — instagram queda undefined, no calificado en 0', async () => {
    const fetchMock = mockFetch(() => jsonResponse({}, false, 500));
    global.fetch = fetchMock;

    const service = new InstagramScanService(configServiceConToken());
    const resultado = await service.escanear(
      'https://www.instagram.com/haciendalaprovidenciaoficial/',
    );

    expect(resultado.instagram).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2); // un reintento
    expect(resultado.advertencias.some((a) => a.includes('regla 4'))).toBe(
      true,
    );
  });

  it('regla 4: una respuesta con shape inesperado (no un array) también cuenta como fallo del servicio', async () => {
    global.fetch = mockFetch(() => jsonResponse({ error: 'algo raro' }));

    const service = new InstagramScanService(configServiceConToken());
    const resultado = await service.escanear(
      'https://www.instagram.com/haciendalaprovidenciaoficial/',
    );

    expect(resultado.instagram).toBeUndefined();
  });

  it('lanza si falta APIFY_TOKEN en la configuración', async () => {
    const configSinToken = { get: () => undefined } as unknown as ConfigService;
    global.fetch = mockFetch(() => jsonResponse([perfilFixture]));

    const service = new InstagramScanService(configSinToken);
    await expect(
      service.escanear(
        'https://www.instagram.com/haciendalaprovidenciaoficial/',
      ),
    ).rejects.toThrow('APIFY_TOKEN no está configurada');
  });
});
