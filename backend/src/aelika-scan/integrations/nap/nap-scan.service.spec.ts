import { NapScanService } from './nap-scan.service';

describe('NapScanService', () => {
  const service = new NapScanService();

  it('todos coinciden (tras normalizar) da consistente en los 3 campos', () => {
    const resultado = service.comparar({
      googleMaps: {
        nombre: 'Hacienda La Providencia',
        direccion: 'Calle 123, Zapopan',
        telefono: '+52 33 3833 3851',
      },
      sitioWeb: {
        nombre: 'hacienda la providencia',
        direccion: 'calle 123, zapopan',
        telefono: '3338333851',
      },
      facebook: {
        nombre: 'Hacienda La Providencia.',
        direccion: 'Calle 123, Zapopan',
        telefono: '523338333851',
      },
    });

    expect(resultado.nap).toEqual({
      nombreConsistente: { disponible: true, consistente: true },
      direccionConsistente: { disponible: true, consistente: true },
      telefonoConsistente: { disponible: true, consistente: true },
    });
    expect(resultado.advertencias).toEqual([]);
  });

  it('normaliza espacios múltiples y puntuación común en nombre/dirección', () => {
    const resultado = service.comparar({
      googleMaps: {
        nombre: 'Hacienda   La  Providencia',
        direccion: null,
        telefono: null,
      },
      sitioWeb: {
        nombre: 'hacienda, la, providencia',
        direccion: null,
        telefono: null,
      },
    });

    expect(resultado.nap?.nombreConsistente).toEqual({
      disponible: true,
      consistente: true,
    });
  });

  it('teléfono: compara solo los últimos 10 dígitos, sin importar prefijo de país', () => {
    const resultado = service.comparar({
      googleMaps: {
        nombre: null,
        direccion: null,
        telefono: '+52 33 3833 3851',
      },
      instagram: { nombre: null, direccion: null, telefono: '5213338333851' },
    });

    expect(resultado.nap?.telefonoConsistente).toEqual({
      disponible: true,
      consistente: true,
    });
  });

  it('dirección con datos que de verdad difieren (ej. código postal distinto) da Necesita atención, no un bug', () => {
    const resultado = service.comparar({
      googleMaps: {
        nombre: null,
        direccion: 'Prol. Río Blanco 1727, Zapopan, 45133',
        telefono: null,
      },
      facebook: {
        nombre: null,
        direccion: 'av rio blanco 1727, Zapopan, 45135',
        telefono: null,
      },
    });

    expect(resultado.nap?.direccionConsistente).toEqual({
      disponible: true,
      consistente: false,
    });
  });

  it('regla 5: menos de 2 valores no-nulos para un campo lo excluye, sin marcarlo consistente ni inconsistente', () => {
    const resultado = service.comparar({
      googleMaps: {
        nombre: 'Hacienda La Providencia',
        direccion: null,
        telefono: null,
      },
      instagram: {
        nombre: 'Hacienda La Providencia',
        direccion: null,
        telefono: null,
      },
    });

    // Nombre sí tiene 2 valores -> disponible; dirección/teléfono no tienen ninguno.
    expect(resultado.nap?.nombreConsistente).toEqual({
      disponible: true,
      consistente: true,
    });
    expect(resultado.nap?.direccionConsistente).toEqual({ disponible: false });
    expect(resultado.nap?.telefonoConsistente).toEqual({ disponible: false });
    expect(
      resultado.advertencias.some((a) => a.includes('"Dirección" excluida')),
    ).toBe(true);
  });

  it('regla 4: si ningún campo tiene suficientes datos, la categoría completa se excluye (undefined)', () => {
    const resultado = service.comparar({
      googleMaps: {
        nombre: 'Único dato disponible',
        direccion: null,
        telefono: null,
      },
    });

    expect(resultado.nap).toBeUndefined();
    expect(resultado.advertencias.some((a) => a.includes('regla 4'))).toBe(
      true,
    );
  });

  it('sin ninguna fuente presente (las 4 se excluyeron en sus propias integraciones) también da regla 4', () => {
    const resultado = service.comparar({});

    expect(resultado.nap).toBeUndefined();
  });
});
