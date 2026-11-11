import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  formatoDuracion,
  diaDeFecha,
  entregaMasTemprana,
  sumarDiasFecha,
  validarEntregaProgramada,
  type HorarioSemana,
  type ReglasEntrega,
} from './horario';

const abierto = { abierto: true, apertura: '09:00', cierre: '18:00' };
const cerrado = { abierto: false, apertura: null, cierre: null };
// Domingo cerrado, el resto 09:00-18:00.
const HORARIO: HorarioSemana = {
  lunes: abierto,
  martes: abierto,
  miercoles: abierto,
  jueves: abierto,
  viernes: abierto,
  sabado: abierto,
  domingo: cerrado,
};

// Martes 2026-11-10 12:00 en Ciudad de México (UTC-6, sin horario de verano) = 18:00Z.
const AHORA = new Date('2026-11-10T18:00:00Z');
const base: ReglasEntrega = { anticipacionMinutos: 0, diasMaxAgendar: 0, margenMinutos: 15 };

describe('fechas de calendario', () => {
  it('suma días y calcula el día de la semana', () => {
    expect(sumarDiasFecha('2026-11-30', 1)).toBe('2026-12-01');
    expect(diaDeFecha('2026-11-10')).toBe('martes');
    expect(diaDeFecha('2026-11-15')).toBe('domingo');
  });
});

describe('entregaMasTemprana', () => {
  it('sin anticipación usa el margen base', () => {
    expect(entregaMasTemprana(base, AHORA)).toEqual({ fecha: '2026-11-10', hora: '12:15' });
  });
  it('con 24 h cae al día siguiente a la misma hora', () => {
    expect(entregaMasTemprana({ ...base, anticipacionMinutos: 1440 }, AHORA)).toEqual({ fecha: '2026-11-11', hora: '12:00' });
  });
});

describe('validarEntregaProgramada', () => {
  it('hoy, sin anticipación: acepta una hora posterior al margen y devuelve hoy', () => {
    expect(validarEntregaProgramada(HORARIO, { hora: '13:00' }, base, AHORA)).toBe('2026-11-10');
  });

  it('hoy: rechaza una hora dentro del margen de 15 min', () => {
    expect(() => validarEntregaProgramada(HORARIO, { hora: '12:10' }, base, AHORA)).toThrow(BadRequestException);
  });

  it('rechaza horas fuera del horario del día', () => {
    expect(() => validarEntregaProgramada(HORARIO, { hora: '18:00' }, base, AHORA)).toThrow(BadRequestException);
  });

  it('rechaza fechas pasadas y más allá de diasMaxAgendar', () => {
    expect(() => validarEntregaProgramada(HORARIO, { fecha: '2026-11-09', hora: '13:00' }, base, AHORA)).toThrow(
      BadRequestException,
    );
    expect(() =>
      validarEntregaProgramada(HORARIO, { fecha: '2026-11-11', hora: '13:00' }, base, AHORA),
    ).toThrow(/primer día disponible/);
    expect(() =>
      validarEntregaProgramada(HORARIO, { fecha: '2026-11-14', hora: '13:00' }, { ...base, diasMaxAgendar: 3 }, AHORA),
    ).toThrow(/hasta 3 día/);
  });

  it('rechaza un día en que el negocio no abre', () => {
    expect(() =>
      validarEntregaProgramada(HORARIO, { fecha: '2026-11-15', hora: '13:00' }, { ...base, diasMaxAgendar: 7 }, AHORA),
    ).toThrow(ConflictException);
  });

  it('anticipación 24 h: hoy ya no alcanza y mañana solo desde la misma hora', () => {
    const reglas = { ...base, anticipacionMinutos: 1440, diasMaxAgendar: 3 };
    expect(() => validarEntregaProgramada(HORARIO, { hora: '17:00' }, reglas, AHORA)).toThrow(/24 h de anticipación/);
    expect(() => validarEntregaProgramada(HORARIO, { fecha: '2026-11-11', hora: '11:30' }, reglas, AHORA)).toThrow(
      /24 h de anticipación/,
    );
    expect(validarEntregaProgramada(HORARIO, { fecha: '2026-11-11', hora: '12:00' }, reglas, AHORA)).toBe('2026-11-11');
    expect(validarEntregaProgramada(HORARIO, { fecha: '2026-11-12', hora: '09:00' }, reglas, AHORA)).toBe('2026-11-12');
  });

  it('la ventana de días cuenta desde el primer día disponible, no desde hoy', () => {
    // 48 h: el primer día es el jueves 12; con 3 días de ventana llega hasta el domingo 15 (cerrado) / sábado 14.
    const reglas = { ...base, anticipacionMinutos: 2880, diasMaxAgendar: 3 };
    expect(validarEntregaProgramada(HORARIO, { fecha: '2026-11-14', hora: '10:00' }, reglas, AHORA)).toBe('2026-11-14');
    expect(() => validarEntregaProgramada(HORARIO, { fecha: '2026-11-16', hora: '10:00' }, reglas, AHORA)).toThrow(
      /hasta 3 día/,
    );
  });
});

describe('formatoDuracion', () => {
  it('muestra minutos, horas o ambos', () => {
    expect(formatoDuracion(15)).toBe('15 min');
    expect(formatoDuracion(120)).toBe('2 h');
    expect(formatoDuracion(75)).toBe('1 h 15 min');
  });
});
