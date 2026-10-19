import {
  esLunes,
  estadoEnSemana,
  etapaActivacion,
  horasRecibidoAConfirmado,
  lunesDe,
  mediana,
  puntualidadEntregas,
  resumenOrigen,
  semanasAnteriores,
  semanasReferencia,
  type PedidoResumen,
} from './adopcion-calculo';

const p = (
  semana: string,
  extra: Partial<PedidoResumen> = {},
): PedidoResumen => ({
  clienteId: 'c',
  semana,
  cancelado: false,
  porConfirmar: false,
  ...extra,
});

describe('adopcion-calculo', () => {
  it('semanas: lunes a domingo en hora de Ciudad de México', () => {
    expect(lunesDe('2026-10-04')).toBe('2026-09-28'); // domingo
    expect(lunesDe('2026-09-28')).toBe('2026-09-28');
    expect(esLunes('2026-10-05')).toBe(true);
    expect(esLunes('2026-10-06')).toBe(false);
    expect(esLunes('basura')).toBe(false);
    // Domingo 23:30 CDMX (= lunes 05:30Z) sigue siendo la semana que termina.
    expect(semanasReferencia(new Date('2026-10-05T05:30:00Z'))).toEqual({
      hoy: '2026-10-04',
      enCurso: '2026-09-28',
      proxima: '2026-10-05',
    });
    expect(semanasAnteriores('2026-10-05')).toEqual([
      '2026-09-28',
      '2026-09-21',
      '2026-09-14',
      '2026-09-07',
    ]);
  });

  it('estado en la semana', () => {
    const sel = '2026-10-05';
    expect(estadoEnSemana([], sel)).toBe('NO_HA_PEDIDO');
    expect(estadoEnSemana([p('2026-09-28')], sel)).toBe('NO_HA_PEDIDO');
    expect(estadoEnSemana([p('2026-09-28'), p('2026-09-21')], sel)).toBe(
      'NO_HA_PEDIDO_HABITUAL',
    );
    expect(
      estadoEnSemana(
        [p('2026-09-28', { cancelado: true }), p('2026-09-21')],
        sel,
      ),
    ).toBe('NO_HA_PEDIDO');
    expect(estadoEnSemana([p(sel)], sel)).toBe('PIDIO');
    expect(estadoEnSemana([p(sel, { porConfirmar: true })], sel)).toBe(
      'SIN_CONFIRMAR',
    );
    expect(estadoEnSemana([p(sel, { cancelado: true })], sel)).toBe(
      'CANCELADO',
    );
    expect(estadoEnSemana([p(sel, { cancelado: true }), p(sel)], sel)).toBe(
      'PIDIO',
    );
  });

  it('etapa: la más alta alcanzada, sin exigir las anteriores', () => {
    const base = {
      seleccionada: '2026-10-05',
      pedidosCliente: [] as PedidoResumen[],
      tienePedidoAlgunaVez: false,
      ultimoAccesoAt: null,
    };
    expect(etapaActivacion(base)).toBe('SIN_ACTIVIDAD');
    expect(etapaActivacion({ ...base, ultimoAccesoAt: new Date() })).toBe(
      'ACCEDIO',
    );
    expect(etapaActivacion({ ...base, tienePedidoAlgunaVez: true })).toBe(
      'HIZO_PEDIDO',
    );
    expect(
      etapaActivacion({
        ...base,
        tienePedidoAlgunaVez: true,
        pedidosCliente: [p('2026-09-28'), p('2026-09-21'), p('2026-09-14')],
      }),
    ).toBe('PIDE_CON_REGULARIDAD');
  });

  it('mediana, tiempos y origen sin casos no inventan nada', () => {
    expect(mediana([])).toBeNull();
    expect(mediana([5, 1, 3])).toBe(3);
    expect(mediana([1, 2, 3, 4])).toBe(2.5);
    expect(horasRecibidoAConfirmado([])).toEqual({
      casos: 0,
      medianaHoras: null,
      maximoHoras: null,
    });
    const t = new Date('2026-10-01T10:00:00Z');
    expect(
      horasRecibidoAConfirmado([
        { creadoAt: t, confirmadoAt: new Date(t.getTime() + 2 * 3_600_000) },
        { creadoAt: t, confirmadoAt: null },
      ]),
    ).toEqual({ casos: 1, medianaHoras: 2, maximoHoras: 2 });
    expect(resumenOrigen({ portal: 0, panel: 0 }).porcentajePortal).toBeNull();
    expect(resumenOrigen({ portal: 1, panel: 3 })).toMatchObject({
      casos: 4,
      porcentajePortal: 25,
      porcentajePanel: 75,
    });
  });

  it('puntualidad: compara el día de cierre en CDMX con el día programado', () => {
    const fecha = new Date('2026-10-01T00:00:00Z');
    expect(
      puntualidadEntregas([
        { fecha, estadoCambiadoAt: new Date('2026-10-02T05:30:00Z') }, // 1 oct 23:30 CDMX: a tiempo
        { fecha, estadoCambiadoAt: new Date('2026-10-02T06:30:00Z') }, // 2 oct 00:30 CDMX: después
        { fecha, estadoCambiadoAt: null },
      ]),
    ).toEqual({
      casos: 2,
      aTiempo: 1,
      despues: 1,
      sinDato: 1,
      porcentajeATiempo: 50,
    });
  });
});
