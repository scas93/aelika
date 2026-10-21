import { longitudNota, normalizarNotaLinea, NOTA_LINEA_MAX } from './nota-linea';

describe('normalizarNotaLinea', () => {
  it.each([
    ['  hola  ', 'hola'],
    ['a    b', 'a b'],
    ['a\nb', 'a b'],
    ['a\r\n\r\nb', 'a b'],
    ['a\t\tb', 'a b'],
    ['  Extra   caliente \n sin hielo ', 'Extra caliente sin hielo'],
  ])('%j → %j', (entrada, esperado) => {
    expect(normalizarNotaLinea(entrada)).toBe(esperado);
  });

  it.each(['', '   ', '\n\t\n', null, undefined])('%j = sin nota (null)', (entrada) => {
    expect(normalizarNotaLinea(entrada)).toBeNull();
  });

  it('conserva mayúsculas, acentos y caracteres especiales tal cual', () => {
    expect(normalizarNotaLinea('Sin <b>Cebolla</b> & *ñandú* 🙏')).toBe('Sin <b>Cebolla</b> & *ñandú* 🙏');
  });
});

describe('longitudNota', () => {
  it('cuenta caracteres (puntos de código): un emoji es 1', () => {
    expect(longitudNota('😀'.repeat(NOTA_LINEA_MAX))).toBe(NOTA_LINEA_MAX);
    expect(longitudNota('abc')).toBe(3);
  });
});
