import { ConfigService } from '@nestjs/config';
import { GoogleMapsScanService } from './google-maps-scan.service';
import {
  GoogleMapsBusquedaError,
  GoogleMapsDetallesError,
  NegocioNoEncontradoError,
} from './google-maps-scan.errors';
import { NivelCheck } from '../../scoring/types';

// Todas las pruebas mockean fetch — nunca le pegan a Google Places ni a
// Outscraper reales (ver "Verificación esperada" del prompt de esta
// integración). La llamada real contra "Hacienda La Providencia" (Zapopan)
// fue solo la verificación manual puntual de este prompt, hecha aparte.

function configServiceConKeys(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'GOOGLE_PLACES_API_KEY') return 'test-google-key';
      if (key === 'OUTSCRAPER_API_KEY') return 'test-outscraper-key';
      return undefined;
    },
  } as unknown as ConfigService;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

// jest.fn con un mock síncrono que retorna una Response ya resuelta — evita
// declarar cada mock como `async` sin ningún `await` adentro (regla de lint).
function mockFetch(impl: (url: string | URL) => Response): typeof fetch {
  return jest.fn((url: string | URL) => Promise.resolve(impl(url)));
}

// Fixture basada en la respuesta real de Place Details para "Hacienda La
// Providencia" (verificación manual de este prompt) — 5 de 7 días con
// horario definido, sin fecha de fotos.
const placeDetailsFixture = {
  displayName: { text: 'Hacienda La Providencia' },
  formattedAddress:
    'Prol. Río Blanco 1727, Vistas del Centinela, Zapopan, Jal.',
  internationalPhoneNumber: '+52 33 3833 3851',
  websiteUri: 'http://www.haciendalaprovidencia.com/',
  rating: 4.6,
  userRatingCount: 3599,
  regularOpeningHours: {
    periods: [
      { open: { day: 1 } },
      { open: { day: 2 } },
      { open: { day: 3 } },
      { open: { day: 4 } },
      { open: { day: 5 } },
    ],
  },
  photos: new Array(10).fill({}), // Place Details cachea máx. ~10, no el total real.
  primaryType: 'event_venue',
};

const ahora = Date.now();
const diasAtras = (dias: number) =>
  new Date(ahora - dias * 24 * 60 * 60 * 1000).toISOString();

// Fixture basada en la respuesta real de Outscraper (verificación manual) —
// negocio verificado, 2904 fotos reales, reseñas con y sin respuesta del dueño.
const outscraperFixture = {
  data: [
    {
      name: 'Hacienda La Providencia',
      address: 'Prol. Río Blanco 1727, Vistas del Centinela, Zapopan, Jal.',
      phone: '+52 33 3833 3851',
      reviews: 3599,
      photos_count: 2904,
      verified: true,
      reviews_data: [
        {
          review_datetime_utc: diasAtras(10),
          owner_answer: 'Gracias por tu visita',
        },
        { review_datetime_utc: diasAtras(40), owner_answer: null },
        { review_datetime_utc: diasAtras(200), owner_answer: 'Gracias' }, // fuera de la ventana de 6 meses
      ],
    },
  ],
};

describe('GoogleMapsScanService', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('resuelve el Place ID vía Text Search cuando se da nombre + ciudad, y arma el resultado completo', async () => {
    const fetchMock = mockFetch((url) => {
      const u = String(url);
      if (u.includes('searchText')) {
        return jsonResponse({ places: [{ id: 'PLACE_ID_TEST' }] });
      }
      if (u.includes('outscraper')) {
        return jsonResponse(outscraperFixture);
      }
      return jsonResponse(placeDetailsFixture);
    });
    global.fetch = fetchMock;

    const service = new GoogleMapsScanService(configServiceConKeys());
    const resultado = await service.escanear({
      nombre: 'Hacienda La Providencia',
      ciudad: 'Zapopan',
    });

    expect(resultado.googleMaps.perfilReclamado).toBe(true);
    expect(resultado.googleMaps.categoriaPrincipalAsignada).toBe(true);
    expect(resultado.googleMaps.horario).toBe(NivelCheck.ACEPTABLE); // 5 de 7 días
    expect(resultado.googleMaps.telefonoPresente).toBe(true);
    expect(resultado.googleMaps.sitioWebPresente).toBe(true);
    expect(resultado.googleMaps.fotos).toEqual({
      cantidad: 2904,
      actividadUltimos90Dias: true,
    });
    expect(resultado.googleMaps.ratingPromedio).toBe(4.6);
    expect(resultado.googleMaps.totalResenas).toBe(3599);
    expect(resultado.googleMaps.velocidadResenasNuevas).toEqual({
      disponible: true,
      totalUltimos6Meses: 2, // las de hace 10 y 40 días; la de 200 días queda fuera
      promedioMensualUltimos6Meses: 2 / 6,
    });
    expect(resultado.googleMaps.tasaRespuestaResenas).toEqual({
      disponible: true,
      valor: (2 / 3) * 100,
    });

    expect(resultado.nap).toEqual({
      nombre: 'Hacienda La Providencia',
      direccion: 'Prol. Río Blanco 1727, Vistas del Centinela, Zapopan, Jal.',
      telefono: '+52 33 3833 3851',
    });

    expect(resultado.advertencias).toEqual([]);
  });

  it('usa el Place ID directo sin llamar a Text Search', async () => {
    const fetchMock = mockFetch((url) => {
      const u = String(url);
      if (u.includes('searchText')) {
        throw new Error('no debería llamarse Text Search con placeId directo');
      }
      if (u.includes('outscraper')) return jsonResponse(outscraperFixture);
      return jsonResponse(placeDetailsFixture);
    });
    global.fetch = fetchMock;

    const service = new GoogleMapsScanService(configServiceConKeys());
    await service.escanear({ placeId: 'PLACE_ID_TEST' });

    expect(fetchMock).toHaveBeenCalledTimes(2); // Place Details + Outscraper, sin Text Search
  });

  it('Text Search sin resultados lanza NegocioNoEncontradoError', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ places: [] }));
    global.fetch = fetchMock;

    const service = new GoogleMapsScanService(configServiceConKeys());
    await expect(
      service.escanear({ nombre: 'Negocio Inexistente', ciudad: 'Nadaville' }),
    ).rejects.toThrow(NegocioNoEncontradoError);
  });

  it('una falla técnica de Text Search lanza GoogleMapsBusquedaError (falla dura, distinguible)', async () => {
    const fetchMock = mockFetch(() => jsonResponse({}, false, 500));
    global.fetch = fetchMock;

    const service = new GoogleMapsScanService(configServiceConKeys());
    await expect(
      service.escanear({ nombre: 'X', ciudad: 'Y' }),
    ).rejects.toThrow(GoogleMapsBusquedaError);
  });

  it('una falla de Place Details lanza GoogleMapsDetallesError (falla dura)', async () => {
    const fetchMock = mockFetch((url) => {
      const u = String(url);
      if (u.includes('outscraper')) return jsonResponse(outscraperFixture);
      return jsonResponse({}, false, 500);
    });
    global.fetch = fetchMock;

    const service = new GoogleMapsScanService(configServiceConKeys());
    await expect(
      service.escanear({ placeId: 'PLACE_ID_TEST' }),
    ).rejects.toThrow(GoogleMapsDetallesError);
  });

  it('una falla de Outscraper degrada parcialmente en vez de fallar duro, y lo declara en advertencias', async () => {
    const fetchMock = mockFetch((url) => {
      const u = String(url);
      if (u.includes('outscraper')) return jsonResponse({}, false, 503);
      return jsonResponse(placeDetailsFixture);
    });
    global.fetch = fetchMock;

    const service = new GoogleMapsScanService(configServiceConKeys());
    const resultado = await service.escanear({ placeId: 'PLACE_ID_TEST' });

    // No lanza — la categoría se sigue evaluando con lo que Place Details trajo.
    expect(resultado.googleMaps.velocidadResenasNuevas).toEqual({
      disponible: false,
    });
    expect(resultado.googleMaps.tasaRespuestaResenas).toEqual({
      disponible: false,
    });
    // Sin Outscraper, "verified" es desconocido -> se asume false, conservador.
    expect(resultado.googleMaps.perfilReclamado).toBe(false);
    // Sin Outscraper, el conteo de fotos cae al máximo ~10 de Place Details.
    expect(resultado.googleMaps.fotos.cantidad).toBe(10);
    // Volumen de reseñas sigue disponible — viene de Place Details, no de Outscraper.
    expect(resultado.googleMaps.totalResenas).toBe(3599);

    expect(resultado.advertencias.length).toBeGreaterThan(0);
    expect(resultado.advertencias.some((a) => a.includes('Outscraper'))).toBe(
      true,
    );
  });

  it('horario: 7 días definidos da Óptimo, 0 días da Necesita atención', async () => {
    const fetchMock = mockFetch((url) => {
      const u = String(url);
      if (u.includes('outscraper')) return jsonResponse(outscraperFixture);
      return jsonResponse({
        ...placeDetailsFixture,
        regularOpeningHours: {
          periods: Array.from({ length: 7 }, (_, day) => ({ open: { day } })),
        },
      });
    });
    global.fetch = fetchMock;

    const service = new GoogleMapsScanService(configServiceConKeys());
    const completo = await service.escanear({ placeId: 'PLACE_ID_TEST' });
    expect(completo.googleMaps.horario).toBe(NivelCheck.OPTIMO);

    const fetchMockSinHorario = mockFetch((url) => {
      const u = String(url);
      if (u.includes('outscraper')) return jsonResponse(outscraperFixture);
      return jsonResponse({
        ...placeDetailsFixture,
        regularOpeningHours: undefined,
      });
    });
    global.fetch = fetchMockSinHorario;

    const ausente = await service.escanear({ placeId: 'PLACE_ID_TEST' });
    expect(ausente.googleMaps.horario).toBe(NivelCheck.NECESITA_ATENCION);
  });

  it('lanza si falta la API key de Google en la configuración', async () => {
    const configSinKeys = { get: () => undefined } as unknown as ConfigService;
    const service = new GoogleMapsScanService(configSinKeys);
    await expect(
      service.escanear({ placeId: 'PLACE_ID_TEST' }),
    ).rejects.toThrow('GOOGLE_PLACES_API_KEY no está configurada');
  });
});
