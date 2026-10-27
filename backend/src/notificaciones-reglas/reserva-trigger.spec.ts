import { coincideIdioma, horaCdmx, hoyCdmx, validarFiltroReserva, validarTriggerConfigReserva, ventanaActiva } from './reserva-trigger';

describe('reserva-trigger (hora y día de CDMX)', () => {
  it('hoyCdmx y horaCdmx siguen CDMX, no UTC', () => {
    const antes = new Date('2026-10-01T05:59:00.000Z'); // 23:59 del 30 en CDMX
    const despues = new Date('2026-10-01T06:00:00.000Z'); // 00:00 del 1
    expect(hoyCdmx(antes).toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(hoyCdmx(despues).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(horaCdmx(antes)).toBe(23);
    expect(horaCdmx(despues)).toBe(0);
  });
  it('ventanaActiva: cada hora siempre; diaria desde su hora hasta el fin del día', () => {
    const c = { frecuencia: 'DIARIA' as const, hora: 11 };
    expect(ventanaActiva(c, new Date('2026-09-30T16:59:00.000Z'))).toBe(false); // 10:59
    expect(ventanaActiva(c, new Date('2026-09-30T17:00:00.000Z'))).toBe(true); // 11:00
    expect(ventanaActiva(c, new Date('2026-10-01T05:59:00.000Z'))).toBe(true); // 23:59
    expect(ventanaActiva(c, new Date('2026-10-01T06:00:00.000Z'))).toBe(false); // 00:00 del día siguiente
    expect(ventanaActiva({ frecuencia: 'CADA_HORA' }, new Date('2026-10-01T06:00:00.000Z'))).toBe(true);
  });
  it('coincideIdioma: sin idioma cuenta como ES', () => {
    const es = [{ campo: 'IDIOMA_HUESPED', operador: 'ES', valor: 'ES' }] as any;
    const noEs = [{ campo: 'IDIOMA_HUESPED', operador: 'NO_ES', valor: 'ES' }] as any;
    expect([null, '', 'es', 'ES'].map((i) => coincideIdioma(es, i))).toEqual([true, true, true, true]);
    expect([null, 'EN', 'de'].map((i) => coincideIdioma(noEs, i))).toEqual([false, true, true]);
  });
  it('validaciones', () => {
    expect(validarTriggerConfigReserva({ frecuencia: 'DIARIA', hora: 0 })).toEqual({ frecuencia: 'DIARIA', hora: 0 });
    expect(() => validarTriggerConfigReserva({ frecuencia: 'DIARIA', hora: 1.5 })).toThrow();
    expect(() => validarFiltroReserva([{ campo: 'IDIOMA_HUESPED', operador: 'ES', valor: 'es' }])).toThrow(/días/);
    expect(validarFiltroReserva([{ campo: 'DIAS_PARA_CHECKIN', operador: 'IGUAL', valor: -1 }, { campo: 'IDIOMA_HUESPED', operador: 'NO_ES', valor: 'en' }])[1].valor).toBe('EN');
  });
});
