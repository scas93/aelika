import { normalizarTelefonoInternacional as n, telefonoParaEnvio } from './telefono-internacional';

describe('normalizarTelefonoInternacional', () => {
  it('México igual que hoy: 10 dígitos sin "+", con cualquier formato', () => {
    expect(n('5511112222')).toBe('5511112222');
    expect(n('55-1111-2222')).toBe('5511112222');
    expect(n('(55) 1111.2222')).toBe('5511112222');
    expect(n('+52 33 1485 0000')).toBe('3314850000');
    expect(n('+52 3319440000')).toBe('3319440000');
    expect(n('+529841130000')).toBe('9841130000');
    expect(n('+52 1 33 1485 0000')).toBe('3314850000');
    expect(n('525511112222')).toBe('5511112222');
    expect(n('5215511112222')).toBe('5511112222');
  });
  it('internacionales completos con "+"', () => {
    expect(n('+1 818 814 0000')).toBe('+18188140000');
    expect(n('+507 -60150000')).toBe('+50760150000');
    expect(n('+44 226250000')).toBe('+44226250000');
    expect(n('0044 226250000')).toBe('+44226250000');
    expect(n('011 44 226250000')).toBe('+44226250000');
  });
  it('un internacional de 10 dígitos totales no choca con un mexicano', () => {
    expect(n('+372 5123 456')).toBe('+3725123456');
  });
  it('sin "+": EE. UU. con 1 al inicio, otras longitudes', () => {
    expect(n('1 818 814 0000')).toBe('+18188140000');
    expect(n('55111122')).toBe('55111122');
    expect(n('442262500001')).toBe('+442262500001');
  });
  it('+52 con longitud rara se conserva completo', () => {
    expect(n('+52 33 1485')).toBe('+52331485');
  });
  it('inutilizables: vacío, corto, placeholder, demasiado largo', () => {
    expect(n('')).toBeNull();
    expect(n(null)).toBeNull();
    expect(n('   ')).toBeNull();
    expect(n('+1 1111111111')).toBeNull();
    expect(n('+11 1111111111')).toBeNull();
    expect(n('0000000000')).toBeNull();
    expect(n('1234567')).toBeNull();
    expect(n('+1234567890123456')).toBeNull();
  });
  it('envío: +52 solo a los guardados sin "+"', () => {
    expect(telefonoParaEnvio('5511112222')).toBe('+525511112222');
    expect(telefonoParaEnvio('+18188140000')).toBe('+18188140000');
  });
});
