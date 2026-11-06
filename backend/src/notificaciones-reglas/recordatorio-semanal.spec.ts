import { semanasDelHorizonte } from '../portal/portal-calendario';
import { validarBotonUrlValor } from './reglas.service';
import { semanaSiguiente, validarTriggerConfigRecordatorio, ventanaActivaRecordatorio } from './recordatorio-semanal';

describe('recordatorio semanal · semana siguiente (CDMX)', () => {
  it('es la siguiente a la semana en curso, de lunes a domingo, sin importar el día', () => {
    // 2026-11-02 es lunes; la semana siguiente es 9–15 de noviembre (la del ejemplo de producto).
    const dias = ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-08'];
    for (const d of dias) {
      expect(semanaSiguiente(new Date(`${d}T18:00:00.000Z`))).toEqual({ inicio: '2026-11-09', fin: '2026-11-15' });
    }
    // Lunes siguiente: la semana destino se recorre.
    expect(semanaSiguiente(new Date('2026-11-09T18:00:00.000Z'))).toEqual({ inicio: '2026-11-16', fin: '2026-11-22' });
  });

  it('cambia de semana con la medianoche de CDMX (domingo 23:59 → lunes 00:00), no la de UTC', () => {
    expect(semanaSiguiente(new Date('2026-11-09T05:59:00.000Z')).inicio).toBe('2026-11-09'); // domingo 8, 23:59 CDMX
    expect(semanaSiguiente(new Date('2026-11-09T06:00:00.000Z')).inicio).toBe('2026-11-16'); // lunes 9, 00:00 CDMX
  });

  it('es exactamente la segunda semana del calendario del portal', () => {
    for (const iso of ['2026-11-06T19:00:00.000Z', '2026-11-09T05:59:00.000Z', '2026-11-09T06:00:00.000Z', '2026-12-30T18:00:00.000Z']) {
      const ahora = new Date(iso);
      expect(semanaSiguiente(ahora).inicio).toBe(semanasDelHorizonte(ahora, 1)[1]);
      // También con un horizonte mayor: la segunda semana sigue siendo la misma.
      expect(semanaSiguiente(ahora).inicio).toBe(semanasDelHorizonte(ahora, 3)[1]);
    }
  });

  it('cruza fin de mes y de año', () => {
    expect(semanaSiguiente(new Date('2026-12-30T18:00:00.000Z'))).toEqual({ inicio: '2027-01-04', fin: '2027-01-10' });
  });
});

describe('recordatorio semanal · ventana de día y hora', () => {
  const viernes13 = { diaSemana: 'viernes' as const, hora: 13 };
  it('solo ese día y desde su hora hasta el fin del día CDMX', () => {
    expect(ventanaActivaRecordatorio(viernes13, new Date('2026-11-06T18:59:00.000Z'))).toBe(false); // viernes 12:59
    expect(ventanaActivaRecordatorio(viernes13, new Date('2026-11-06T19:00:00.000Z'))).toBe(true); // viernes 13:00
    expect(ventanaActivaRecordatorio(viernes13, new Date('2026-11-07T05:59:00.000Z'))).toBe(true); // viernes 23:59
    expect(ventanaActivaRecordatorio(viernes13, new Date('2026-11-07T06:00:00.000Z'))).toBe(false); // sábado 00:00: nunca al día siguiente
    expect(ventanaActivaRecordatorio(viernes13, new Date('2026-11-05T19:00:00.000Z'))).toBe(false); // jueves
    expect(ventanaActivaRecordatorio(viernes13, new Date('2026-11-13T19:00:00.000Z'))).toBe(true); // el viernes siguiente
  });
});

describe('recordatorio semanal · validaciones', () => {
  it('triggerConfig: día y hora', () => {
    expect(validarTriggerConfigRecordatorio({ diaSemana: 'sabado', hora: 11 })).toEqual({ diaSemana: 'sabado', hora: 11 });
    expect(() => validarTriggerConfigRecordatorio({ diaSemana: 'sábado', hora: 11 })).toThrow();
    expect(() => validarTriggerConfigRecordatorio({ diaSemana: 'viernes', hora: 24 })).toThrow();
    expect(() => validarTriggerConfigRecordatorio({ diaSemana: 'viernes', hora: 13.5 })).toThrow();
    expect(() => validarTriggerConfigRecordatorio({ diaSemana: 'viernes' })).toThrow();
    expect(() => validarTriggerConfigRecordatorio({ diaSemana: 'viernes', hora: 13, extra: 1 })).toThrow();
    expect(() => validarTriggerConfigRecordatorio(undefined)).toThrow();
  });

  it('valor del botón: solo la parte dinámica; vacío o null = sin botón', () => {
    expect(validarBotonUrlValor('panaderia-banetto')).toBe('panaderia-banetto');
    expect(validarBotonUrlValor('  panaderia-banetto  ')).toBe('panaderia-banetto');
    expect(validarBotonUrlValor('')).toBeNull();
    expect(validarBotonUrlValor(null)).toBeNull();
    expect(validarBotonUrlValor(undefined)).toBeNull();
    for (const malo of ['https://pide.aelika.com/panaderia-banetto', '/panaderia-banetto', 'hola mundo', 'javascript:alert(1)']) {
      expect(() => validarBotonUrlValor(malo)).toThrow();
    }
  });
});
