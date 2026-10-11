import { EstadoEntrega, EstadoPedido } from '../../generated/prisma/client';
import {
  calcularCalendario,
  instanteEnMexico,
  lunesDeFecha,
  semanasDelHorizonte,
  type ParametrosCalendario,
  type PedidoSemanaCalendario,
} from './portal-calendario';

const P: ParametrosCalendario = {
  horaEntrega: '08:00',
  horasAgregar: 36,
  horasModificar: 18,
  horizonteSemanas: 1,
};
const sinPedidos = new Map<string, PedidoSemanaCalendario>();
// Miércoles 2026-09-30 10:00 CDMX (UTC-6).
const MIE_10 = new Date('2026-09-30T16:00:00.000Z');

function dia(semanas: ReturnType<typeof calcularCalendario>, fecha: string) {
  for (const s of semanas) {
    const d = s.dias.find((x) => x.fecha === fecha);
    if (d) return d;
  }
  throw new Error(`sin día ${fecha}`);
}

describe('instanteEnMexico', () => {
  it('hora de pared de Ciudad de México → UTC (sin horario de verano desde oct-2022)', () => {
    expect(instanteEnMexico('2026-10-02', '08:00').toISOString()).toBe(
      '2026-10-02T14:00:00.000Z',
    );
    expect(instanteEnMexico('2026-01-15', '23:30').toISOString()).toBe(
      '2026-01-16T05:30:00.000Z',
    );
  });
  it('usa la base IANA: en 2022 había horario de verano (UTC-5 en julio)', () => {
    expect(instanteEnMexico('2022-07-15', '08:00').toISOString()).toBe(
      '2022-07-15T13:00:00.000Z',
    );
    expect(instanteEnMexico('2022-12-15', '08:00').toISOString()).toBe(
      '2022-12-15T14:00:00.000Z',
    );
  });
});

describe('semanas', () => {
  it('lunesDeFecha', () => {
    expect(lunesDeFecha('2026-09-30')).toBe('2026-09-28'); // miércoles
    expect(lunesDeFecha('2026-09-28')).toBe('2026-09-28'); // lunes
    expect(lunesDeFecha('2026-10-04')).toBe('2026-09-28'); // domingo
    expect(lunesDeFecha('2026-10-05')).toBe('2026-10-05');
  });
  it('cambia de semana a medianoche de CDMX, no de UTC', () => {
    // Domingo 23:59 CDMX = lunes 05:59Z → sigue siendo la semana del 28.
    expect(
      semanasDelHorizonte(new Date('2026-10-05T05:59:00.000Z'), 1),
    ).toEqual(['2026-09-28', '2026-10-05']);
    // Lunes 00:00 CDMX = 06:00Z → semana nueva.
    expect(
      semanasDelHorizonte(new Date('2026-10-05T06:00:00.000Z'), 1),
    ).toEqual(['2026-10-05', '2026-10-12']);
  });
  it('horizonte', () => {
    expect(semanasDelHorizonte(MIE_10, 0)).toEqual(['2026-09-28']);
    expect(semanasDelHorizonte(MIE_10, 2)).toEqual([
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
    ]);
  });
});

describe('calcularCalendario · bordes de las horas límite', () => {
  it('agregar: justo en el límite sí, un milisegundo después no', () => {
    // Viernes 2026-10-02 08:00 CDMX = 14:00Z; menos 36 h = 2026-10-01T02:00Z.
    const enLimite = calcularCalendario(
      new Date('2026-10-01T02:00:00.000Z'),
      P,
      sinPedidos,
    );
    expect(dia(enLimite, '2026-10-02')).toMatchObject({
      estado: 'AGREGABLE',
      limiteAt: '2026-10-01T02:00:00.000Z',
    });
    const despues = calcularCalendario(
      new Date('2026-10-01T02:00:00.001Z'),
      P,
      sinPedidos,
    );
    expect(dia(despues, '2026-10-02')).toMatchObject({
      estado: 'NO_DISPONIBLE',
      motivo: 'ANTICIPACION_AGREGAR',
      limiteAt: '2026-10-01T02:00:00.000Z',
    });
    const antes = calcularCalendario(
      new Date('2026-10-01T01:59:59.999Z'),
      P,
      sinPedidos,
    );
    expect(dia(antes, '2026-10-02').estado).toBe('AGREGABLE');
  });

  it('ejemplos del documento (miércoles 10am, sábado 7pm, domingo 10am)', () => {
    const agregables = (d: Date) =>
      calcularCalendario(d, P, sinPedidos)
        .flatMap((s) => s.dias)
        .filter((x) => x.estado === 'AGREGABLE')
        .map((x) => x.fecha);
    // Miércoles 10am: viernes a domingo de esta semana y toda la siguiente.
    expect(agregables(MIE_10)).toEqual([
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);
    // Sábado 7pm (2026-10-03 19:00 CDMX = 2026-10-04T01:00Z): la semana del 5 completa; ya no el domingo 4.
    const sab = agregables(new Date('2026-10-04T01:00:00.000Z'));
    expect(sab).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);
    // Domingo 10am (2026-10-04 16:00Z): martes a domingo de la siguiente semana.
    const dom = agregables(new Date('2026-10-04T16:00:00.000Z'));
    expect(dom).toEqual([
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);
  });

  it('modificar: justo en el límite sí, un milisegundo después ya está cerrado', () => {
    const pedido: PedidoSemanaCalendario = {
      folio: 'P-000001',
      estadoPedido: EstadoPedido.CONFIRMADO_SURTIENDO,
      pagado: false,
      entregas: [{ fecha: '2026-10-07', estado: EstadoEntrega.PENDIENTE }],
    };
    const mapa = new Map([['2026-10-05', pedido]]);
    // Miércoles 2026-10-07 08:00 CDMX = 14:00Z; menos 18 h = 2026-10-06T20:00Z.
    const enLimite = calcularCalendario(
      new Date('2026-10-06T20:00:00.000Z'),
      P,
      mapa,
    );
    expect(dia(enLimite, '2026-10-07')).toMatchObject({
      estado: 'MODIFICABLE',
      limiteAt: '2026-10-06T20:00:00.000Z',
    });
    const despues = calcularCalendario(
      new Date('2026-10-06T20:00:00.001Z'),
      P,
      mapa,
    );
    expect(dia(despues, '2026-10-07')).toMatchObject({
      estado: 'CERRADO',
      motivo: 'ANTICIPACION_MODIFICAR',
    });
  });

  it('una entrega a menos de 36 h pero a más de 18 h se puede modificar pero no agregar', () => {
    const pedido: PedidoSemanaCalendario = {
      folio: 'P-000001',
      estadoPedido: EstadoPedido.CONFIRMADO_SURTIENDO,
      pagado: false,
      entregas: [{ fecha: '2026-10-01', estado: EstadoEntrega.PENDIENTE }],
    };
    const s = calcularCalendario(MIE_10, P, new Map([['2026-09-28', pedido]])); // jueves 08:00 = +22 h
    expect(dia(s, '2026-10-01').estado).toBe('MODIFICABLE');
  });
});

describe('calcularCalendario · pedido Pagado y entregas cerradas', () => {
  it('pedido Pagado: toda la semana CERRADO con PEDIDO_PAGADO (con entrega, sin entrega y días pasados)', () => {
    const pedido: PedidoSemanaCalendario = {
      folio: 'P-000002',
      estadoPedido: EstadoPedido.CONFIRMADO_SURTIENDO,
      pagado: true,
      entregas: [{ fecha: '2026-10-07', estado: EstadoEntrega.PENDIENTE }],
    };
    const s = calcularCalendario(MIE_10, P, new Map([['2026-10-05', pedido]]));
    const semana = s[1];
    expect(
      semana.dias.every(
        (d) =>
          d.estado === 'CERRADO' &&
          d.motivo === 'PEDIDO_PAGADO' &&
          d.accion === null,
      ),
    ).toBe(true);
    expect(semana.puedeCrear).toBe(false);
    expect(semana.pedido).toMatchObject({ folio: 'P-000002', pagado: true });
    // La otra semana no se afecta.
    expect(s[0].dias.some((d) => d.estado === 'AGREGABLE')).toBe(true);
  });

  it('entrega Entregada / No recogida / Cancelada: CERRADO con ENTREGA_CERRADA; Lista sigue editable', () => {
    const pedido: PedidoSemanaCalendario = {
      folio: 'P-000003',
      estadoPedido: EstadoPedido.EN_PROCESO,
      pagado: false,
      entregas: [
        { fecha: '2026-10-05', estado: EstadoEntrega.ENTREGADA },
        { fecha: '2026-10-06', estado: EstadoEntrega.NO_RECOGIDA },
        { fecha: '2026-10-07', estado: EstadoEntrega.LISTA },
      ],
    };
    const s = calcularCalendario(MIE_10, P, new Map([['2026-10-05', pedido]]));
    expect(dia(s, '2026-10-05')).toMatchObject({
      estado: 'CERRADO',
      motivo: 'ENTREGA_CERRADA',
    });
    expect(dia(s, '2026-10-06')).toMatchObject({
      estado: 'CERRADO',
      motivo: 'ENTREGA_CERRADA',
    });
    expect(dia(s, '2026-10-07').estado).toBe('MODIFICABLE');
  });
});

describe('calcularCalendario · parámetros distintos', () => {
  it('hora de entrega y horas límite propias', () => {
    const p: ParametrosCalendario = {
      horaEntrega: '18:30',
      horasAgregar: 24,
      horasModificar: 6,
      horizonteSemanas: 0,
    };
    const s = calcularCalendario(MIE_10, p, sinPedidos);
    expect(s).toHaveLength(1);
    // Jueves 18:30 CDMX = 00:30Z del viernes; menos 24 h = 00:30Z del jueves = miércoles 18:30 CDMX → todavía no (ahora 10:00).
    expect(dia(s, '2026-10-01')).toMatchObject({
      entregaAt: '2026-10-02T00:30:00.000Z',
      estado: 'AGREGABLE',
    });
    // Hoy miércoles a las 18:30 ya pasó? No (10:00): el miércoles 18:30 está a 8.5 h → no cumple 24 h.
    expect(dia(s, '2026-09-30')).toMatchObject({
      estado: 'NO_DISPONIBLE',
      motivo: 'ANTICIPACION_AGREGAR',
    });
  });

  it('con 0 horas de anticipación se puede pedir cualquier entrega futura, no las pasadas', () => {
    const p: ParametrosCalendario = {
      horaEntrega: '08:00',
      horasAgregar: 0,
      horasModificar: 0,
      horizonteSemanas: 0,
    };
    const s = calcularCalendario(MIE_10, p, sinPedidos);
    expect(dia(s, '2026-09-30')).toMatchObject({
      estado: 'NO_DISPONIBLE',
      motivo: 'PASADO',
    }); // 08:00 ya pasó
    expect(dia(s, '2026-10-01').estado).toBe('AGREGABLE');
  });
});
