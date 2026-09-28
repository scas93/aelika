import {
  diasDesde,
  formatDinero,
  formatFechaHoraCorta,
  formatFechaLarga,
  formatMesAnio,
  resumenProductos,
  sanitizarParaMeta,
} from './plantilla-variable-formato';

describe('plantilla-variable-formato', () => {
  describe('formatDinero', () => {
    it('formatea Decimal/number como pesos con separador de miles y 2 decimales', () => {
      expect(formatDinero(1245.5)).toBe('$1,245.50');
      expect(formatDinero('1245.5')).toBe('$1,245.50');
      expect(formatDinero(0)).toBe('$0.00');
    });
  });

  describe('fechas (America/Mexico_City)', () => {
    // 2026-09-24T18:30:00Z = 24 sep, 12:30 en CDMX (UTC-6 en esa fecha).
    const fecha = new Date('2026-09-24T18:30:00.000Z');

    it('formatFechaLarga da "día de mes"', () => {
      expect(formatFechaLarga(fecha)).toBe('24 de septiembre');
    });

    it('formatFechaHoraCorta da "día mes, HH:mm"', () => {
      expect(formatFechaHoraCorta(fecha)).toBe('24 sep, 12:30');
    });

    it('formatMesAnio da "mes de año"', () => {
      expect(formatMesAnio(new Date('2026-03-15T12:00:00.000Z'))).toBe('marzo de 2026');
    });
  });

  describe('diasDesde', () => {
    it('cuenta días transcurridos (ms / 24h), no calendario', () => {
      const ahora = new Date('2026-09-24T12:00:00.000Z');
      const hace18Dias = new Date('2026-09-06T12:00:00.000Z');
      expect(diasDesde(hace18Dias, ahora)).toBe(18);
    });

    it('nunca da negativo si la fecha es posterior a ahora', () => {
      const ahora = new Date('2026-09-24T12:00:00.000Z');
      const futuro = new Date('2026-09-25T12:00:00.000Z');
      expect(diasDesde(futuro, ahora)).toBe(0);
    });
  });

  describe('resumenProductos', () => {
    it('lista hasta 3 productos como "Nx Nombre" separados por coma', () => {
      expect(resumenProductos([{ nombreProducto: 'Concha', cantidad: 2 }])).toBe('2x Concha');
      expect(
        resumenProductos([
          { nombreProducto: 'Concha', cantidad: 2 },
          { nombreProducto: 'Café americano', cantidad: 1 },
        ]),
      ).toBe('2x Concha, 1x Café americano');
    });

    it('agrega " y N más" cuando hay más de 3 productos', () => {
      const items = [
        { nombreProducto: 'Concha', cantidad: 2 },
        { nombreProducto: 'Café americano', cantidad: 1 },
        { nombreProducto: 'Dona', cantidad: 1 },
        { nombreProducto: 'Bolillo', cantidad: 5 },
        { nombreProducto: 'Croissant', cantidad: 2 },
      ];
      expect(resumenProductos(items)).toBe('2x Concha, 1x Café americano, 1x Dona y 2 más');
    });

    it('regresa vacío si no hay items (el fallback lo aplica el resolver, no esta función)', () => {
      expect(resumenProductos([])).toBe('');
    });
  });

  describe('sanitizarParaMeta', () => {
    it('deja un valor limpio tal cual', () => {
      expect(sanitizarParaMeta('Ana López', 'cliente')).toBe('Ana López');
    });

    it('cae al fallback si el valor es vacío o solo espacios', () => {
      expect(sanitizarParaMeta('', 'cliente')).toBe('cliente');
      expect(sanitizarParaMeta('   ', 'cliente')).toBe('cliente');
    });

    it('reemplaza saltos de línea y tabs por espacios', () => {
      expect(sanitizarParaMeta('Línea 1\nLínea 2\tfin', 'fallback')).toBe('Línea 1 Línea 2 fin');
    });

    it('normaliza más de 4 espacios seguidos a 4', () => {
      expect(sanitizarParaMeta('a          b', 'fallback')).toBe('a    b');
    });

    it('conserva hasta 4 espacios seguidos sin tocarlos', () => {
      expect(sanitizarParaMeta('a    b', 'fallback')).toBe('a    b');
    });
  });
});
