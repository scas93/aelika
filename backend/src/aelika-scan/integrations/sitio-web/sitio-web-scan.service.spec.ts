import { ConfigService } from '@nestjs/config';
import { SitioWebScanService } from './sitio-web-scan.service';
import { SitioWebInput } from '../../scoring/types';

// Todas las pruebas mockean fetch — nunca le pegan a sitios reales ni a
// PageSpeed/Custom Search (ver "Verificación esperada" del prompt de esta
// integración). La llamada real contra haciendalaprovidencia.com fue solo
// la verificación manual puntual de este prompt, hecha aparte.

function configServiceConKeys(
  overrides: Record<string, string | undefined> = {},
): ConfigService {
  const defaults: Record<string, string | undefined> = {
    GOOGLE_PAGESPEED_API_KEY: 'test-pagespeed-key',
    GOOGLE_CUSTOM_SEARCH_API_KEY: 'test-cse-key',
    GOOGLE_CUSTOM_SEARCH_CX: 'test-cx',
    ...overrides,
  };
  return { get: (key: string) => defaults[key] } as unknown as ConfigService;
}

function htmlResponse(
  html: string,
  url = 'https://ejemplo.com/',
  ok = true,
  status = 200,
): Response {
  return { ok, status, url, text: () => Promise.resolve(html) } as Response;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as Response;
}

function mockFetch(impl: (url: string) => Response): typeof fetch {
  return jest.fn((url: string | URL) => Promise.resolve(impl(String(url))));
}

const HTML_COMPLETO = `
<html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Restaurant","name":"Hacienda Test","telephone":"+52 33 0000 0000","address":{"streetAddress":"Calle 123","addressLocality":"Zapopan"}}
</script>
<script>fbq('init', '123456');</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script>
</head><body>Hola</body></html>
`;

const HTML_VACIO = `<html><head></head><body>Sin nada instalado</body></html>`;

describe('SitioWebScanService', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('detecta SSL, schema.org LocalBusiness, Meta Pixel y Google Tag desde el HTML, y arma el resultado completo', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('pagespeedonline')) {
        return jsonResponse({
          lighthouseResult: { categories: { performance: { score: 0.95 } } },
        });
      }
      if (url.includes('customsearch')) {
        return jsonResponse({ items: [{ title: 'resultado' }] });
      }
      return htmlResponse(HTML_COMPLETO, 'https://www.ejemplo.com/');
    });
    global.fetch = fetchMock;

    const service = new SitioWebScanService(configServiceConKeys());
    const resultado = await service.escanear('https://www.ejemplo.com/');

    expect(resultado.sitioWeb).toEqual({
      tieneCanal: true,
      sslActivo: true,
      pagespeed: { disponible: true, valor: 95 },
      indexadoGoogle: { disponible: true, indexado: true },
      datosEstructurados: true,
      metaPixelInstalado: true,
      googleTagInstalado: true,
    });

    expect(resultado.nap).toEqual({
      nombre: 'Hacienda Test',
      direccion: 'Calle 123, Zapopan',
      telefono: '+52 33 0000 0000',
    });

    expect(resultado.advertencias).toEqual([]);
  });

  it('sin JSON-LD, pixel ni tag: los tres binarios correspondientes dan false y nap queda en null', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('pagespeedonline')) {
        return jsonResponse({
          lighthouseResult: { categories: { performance: { score: 0.5 } } },
        });
      }
      if (url.includes('customsearch')) {
        return jsonResponse({ items: [] });
      }
      return htmlResponse(HTML_VACIO, 'https://www.ejemplo.com/');
    });
    global.fetch = fetchMock;

    const service = new SitioWebScanService(configServiceConKeys());
    const resultado = await service.escanear('https://www.ejemplo.com/');

    const sitio = resultado.sitioWeb as { tieneCanal: true } & SitioWebInput;
    expect(sitio.datosEstructurados).toBe(false);
    expect(sitio.metaPixelInstalado).toBe(false);
    expect(sitio.googleTagInstalado).toBe(false);
    expect(resultado.nap).toEqual({
      nombre: null,
      direccion: null,
      telefono: null,
    });
  });

  it('SSL se evalúa sobre la URL final tras seguir redirects, no la original', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('pagespeedonline'))
        return jsonResponse({
          lighthouseResult: { categories: { performance: { score: 0.8 } } },
        });
      if (url.includes('customsearch')) return jsonResponse({ items: [] });
      // fetch nativo sigue el redirect solo; simulamos que la Response final trae la URL https.
      return htmlResponse(HTML_VACIO, 'https://www.ejemplo.com/');
    });
    global.fetch = fetchMock;

    const service = new SitioWebScanService(configServiceConKeys());
    const resultado = await service.escanear('http://www.ejemplo.com/');

    expect((resultado.sitioWeb as { sslActivo: boolean }).sslActivo).toBe(true);
  });

  it('sin redirect (el sitio se sirve tal cual en http): SSL da false, un hallazgo real, no un bug', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('pagespeedonline'))
        return jsonResponse({
          lighthouseResult: { categories: { performance: { score: 0.8 } } },
        });
      if (url.includes('customsearch')) return jsonResponse({ items: [] });
      return htmlResponse(HTML_VACIO, 'http://www.ejemplo.com/');
    });
    global.fetch = fetchMock;

    const service = new SitioWebScanService(configServiceConKeys());
    const resultado = await service.escanear('http://www.ejemplo.com/');

    expect((resultado.sitioWeb as { sslActivo: boolean }).sslActivo).toBe(
      false,
    );
  });

  it('regla 3: un sitio inalcanzable tras 2 intentos se trata como "sin canal", no como falla', async () => {
    const fetchMock = mockFetch(() =>
      htmlResponse('', 'https://roto.com/', false, 500),
    );
    global.fetch = fetchMock;

    const service = new SitioWebScanService(configServiceConKeys());
    const resultado = await service.escanear('https://roto.com/');

    expect(resultado.sitioWeb).toEqual({ tieneCanal: false });
    expect(resultado.nap).toEqual({
      nombre: null,
      direccion: null,
      telefono: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2); // reintentó una vez
    expect(
      resultado.advertencias.some((a) =>
        a.includes('no cargó tras 2 intentos'),
      ),
    ).toBe(true);
  });

  it('regla 3: un error de red (no solo HTTP no-ok) también cuenta como intento fallido', async () => {
    const fetchMock = jest.fn(() =>
      Promise.reject(new Error('ENOTFOUND')),
    ) as unknown as typeof fetch;
    global.fetch = fetchMock;

    const service = new SitioWebScanService(configServiceConKeys());
    const resultado = await service.escanear('https://no-existe.com/');

    expect(resultado.sitioWeb).toEqual({ tieneCanal: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('regla 5: PageSpeed falla — se excluye solo Velocidad, el resto de la categoría se sigue evaluando', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('pagespeedonline')) return jsonResponse({}, false, 500);
      if (url.includes('customsearch')) return jsonResponse({ items: [{}] });
      return htmlResponse(HTML_COMPLETO, 'https://www.ejemplo.com/');
    });
    global.fetch = fetchMock;

    const service = new SitioWebScanService(configServiceConKeys());
    const resultado = await service.escanear('https://www.ejemplo.com/');

    const sitio = resultado.sitioWeb as {
      tieneCanal: true;
      pagespeed: unknown;
      datosEstructurados: boolean;
    };
    expect(sitio.pagespeed).toEqual({ disponible: false });
    expect(sitio.datosEstructurados).toBe(true); // el resto no se ve afectado
    expect(resultado.advertencias.some((a) => a.includes('PageSpeed'))).toBe(
      true,
    );
  });

  it('regla 5: Custom Search sin configurar — se excluye solo Indexación', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('pagespeedonline'))
        return jsonResponse({
          lighthouseResult: { categories: { performance: { score: 0.7 } } },
        });
      return htmlResponse(HTML_COMPLETO, 'https://www.ejemplo.com/');
    });
    global.fetch = fetchMock;

    const configSinCse = configServiceConKeys({
      GOOGLE_CUSTOM_SEARCH_API_KEY: undefined,
      GOOGLE_CUSTOM_SEARCH_CX: undefined,
    });
    const service = new SitioWebScanService(configSinCse);
    const resultado = await service.escanear('https://www.ejemplo.com/');

    const sitio = resultado.sitioWeb as {
      tieneCanal: true;
      indexadoGoogle: unknown;
    };
    expect(sitio.indexadoGoogle).toEqual({ disponible: false });
    expect(
      resultado.advertencias.some((a) => a.includes('Custom Search')),
    ).toBe(true);
  });

  it('PageSpeed: usa GOOGLE_PLACES_API_KEY como respaldo si GOOGLE_PAGESPEED_API_KEY no está configurada', async () => {
    let pagespeedUrlUsada = '';
    const fetchMock = mockFetch((url) => {
      if (url.includes('pagespeedonline')) {
        pagespeedUrlUsada = url;
        return jsonResponse({
          lighthouseResult: { categories: { performance: { score: 0.6 } } },
        });
      }
      if (url.includes('customsearch')) return jsonResponse({ items: [] });
      return htmlResponse(HTML_VACIO, 'https://www.ejemplo.com/');
    });
    global.fetch = fetchMock;

    const config = configServiceConKeys({
      GOOGLE_PAGESPEED_API_KEY: undefined,
      GOOGLE_PLACES_API_KEY: 'places-key-respaldo',
    });
    const service = new SitioWebScanService(config);
    await service.escanear('https://www.ejemplo.com/');

    expect(pagespeedUrlUsada).toContain('places-key-respaldo');
  });
});
