import {
  calcularTotales,
  construirCorreoResumen,
  nombreArchivoResumen,
  rangoSemana,
  semanaAnterior,
  ventanaActivaResumen,
} from './resumen-semanal';
import type { FilaPedidoExcel } from '../pedidos-b2b/pedidos-b2b-excel';

const fila = (extra: Partial<FilaPedidoExcel> = {}): FilaPedidoExcel => ({
  folio: 'B-1',
  clienteCodigo: null,
  negocioNombre: 'Abarrotes',
  semanaInicio: new Date('2026-10-26T00:00:00.000Z'),
  notaCliente: null,
  createdAt: new Date('2026-10-20T16:00:00.000Z'),
  estado: 'PENDIENTE_CONFIRMACION',
  cancelado: false,
  estadoPago: 'PENDIENTE',
  pagadoAt: null,
  estadosEntregas: ['PENDIENTE'],
  totalPiezas: 10,
  subtotal: 100,
  descuentoPorcentaje: 0,
  descuentoTotal: 0,
  total: 100.1,
  ...extra,
});

describe('semanaAnterior', () => {
  it('el lunes 10:00 CDMX devuelve la semana que acaba de terminar (lunes a domingo)', () => {
    expect(semanaAnterior(new Date('2026-11-02T16:00:00.000Z'))).toEqual({
      inicio: '2026-10-26',
      fin: '2026-11-01',
    });
  });
  it('cualquier día de la semana en curso da la misma semana anterior; se resuelve en CDMX, no en UTC', () => {
    // Domingo 1 nov 23:00 CDMX = lunes 2 nov 05:00 UTC → todavía es la semana del 26 oct.
    expect(semanaAnterior(new Date('2026-11-02T05:00:00.000Z'))).toEqual({
      inicio: '2026-10-19',
      fin: '2026-10-25',
    });
    expect(semanaAnterior(new Date('2026-11-09T05:59:00.000Z'))).toEqual({
      inicio: '2026-10-26',
      fin: '2026-11-01',
    }); // domingo 23:59
    expect(semanaAnterior(new Date('2026-11-09T06:00:00.000Z'))).toEqual({
      inicio: '2026-11-02',
      fin: '2026-11-08',
    }); // lunes 00:00
  });
});

describe('ventanaActivaResumen (lunes desde las 10:00 CDMX hasta el fin del día)', () => {
  it('lunes 09:59 no; 10:00 sí; 23:59 sí; martes 00:00 no', () => {
    expect(ventanaActivaResumen(new Date('2026-11-02T15:59:00.000Z'))).toBe(
      false,
    ); // 09:59
    expect(ventanaActivaResumen(new Date('2026-11-02T16:00:00.000Z'))).toBe(
      true,
    ); // 10:00
    expect(ventanaActivaResumen(new Date('2026-11-03T05:59:00.000Z'))).toBe(
      true,
    ); // 23:59
    expect(ventanaActivaResumen(new Date('2026-11-03T06:00:00.000Z'))).toBe(
      false,
    ); // martes 00:00
  });
  it('otros días nunca', () => {
    expect(ventanaActivaResumen(new Date('2026-11-04T18:00:00.000Z'))).toBe(
      false,
    );
    expect(ventanaActivaResumen(new Date('2026-11-01T18:00:00.000Z'))).toBe(
      false,
    );
  });
  it('cambio de horario: siempre las 10:00 de CDMX (México ya no tiene horario de verano; las fechas de antes lo respetan vía Intl)', () => {
    // Hoy: UTC-6 todo el año. 2021 tenía horario de verano (abril a octubre: UTC-5): el lunes 12 jul 2021 a las 10:00 CDMX eran las 15:00 UTC.
    expect(ventanaActivaResumen(new Date('2025-07-14T15:59:00.000Z'))).toBe(
      false,
    );
    expect(ventanaActivaResumen(new Date('2025-07-14T16:00:00.000Z'))).toBe(
      true,
    );
    expect(ventanaActivaResumen(new Date('2026-01-12T15:59:00.000Z'))).toBe(
      false,
    );
    expect(ventanaActivaResumen(new Date('2026-01-12T16:00:00.000Z'))).toBe(
      true,
    );
    expect(ventanaActivaResumen(new Date('2021-07-12T14:59:00.000Z'))).toBe(
      false,
    );
    expect(ventanaActivaResumen(new Date('2021-07-12T15:00:00.000Z'))).toBe(
      true,
    );
  });
});

describe('calcularTotales', () => {
  it('cuenta por estado, suma piezas y dinero sin cancelados y separa lo pagado de lo pendiente (centavos exactos)', () => {
    const t = calcularTotales([
      fila({
        estado: 'PENDIENTE_CONFIRMACION',
        total: 0.1,
        estadosEntregas: ['PENDIENTE', 'PENDIENTE'],
      }),
      fila({
        estado: 'CONFIRMADO_SURTIENDO',
        total: 0.2,
        estadosEntregas: ['LISTA'],
      }),
      fila({
        estado: 'EN_PROCESO',
        total: 100,
        estadoPago: 'PAGADO',
        estadosEntregas: ['ENTREGADA', 'PENDIENTE'],
      }),
      fila({
        estado: 'COMPLETADO',
        total: 50.55,
        estadoPago: 'PAGADO',
        estadosEntregas: ['ENTREGADA', 'NO_RECOGIDA', 'CANCELADA'],
      }),
      fila({
        estado: 'EN_PROCESO',
        cancelado: true,
        total: 999,
        totalPiezas: 99,
        estadosEntregas: ['ENTREGADA', 'CANCELADA'],
      }),
    ]);
    expect(t).toMatchObject({
      pedidos: 4,
      porConfirmar: 1,
      confirmados: 1,
      enProceso: 1,
      completados: 1,
      cancelados: 1,
      piezas: 40,
      totalCentavos: 15085,
      pagados: 2,
      pagadoCentavos: 15055,
      pendientesDePago: 2,
      pendienteCentavos: 30,
      hayPedidos: true,
    });
    expect(t.entregas).toEqual({
      pendientes: 3,
      listas: 1,
      entregadas: 2,
      noRecogidas: 1,
      canceladas: 1,
    });
  });
  it('solo cancelados: hay pedidos, pero los totales quedan en cero', () => {
    const t = calcularTotales([fila({ cancelado: true })]);
    expect(t).toMatchObject({
      pedidos: 0,
      cancelados: 1,
      piezas: 0,
      totalCentavos: 0,
      hayPedidos: true,
    });
  });
  it('sin filas: no hay pedidos', () => {
    expect(calcularTotales([]).hayPedidos).toBe(false);
  });
});

describe('contenido del correo', () => {
  const semana = { inicio: '2026-10-26', fin: '2026-11-01' };
  it('rango de la semana en español', () => {
    expect(rangoSemana(semana)).toBe('26 de octubre al 1 de noviembre');
  });
  it('asunto con negocio, «Resumen semanal» y rango; destaca lo pendiente de revisar; incluye todos los bloques', () => {
    const c = construirCorreoResumen(
      'Panadería «La Niña»',
      semana,
      calcularTotales([
        fila({ estadosEntregas: ['PENDIENTE', 'PENDIENTE'] }),
        fila({ cancelado: true }),
      ]),
    );
    expect(c.asunto).toBe(
      'Panadería «La Niña» · Resumen semanal · 26 de octubre al 1 de noviembre',
    );
    for (const t of [c.texto, c.html]) {
      expect(t.includes('POR REVISAR') || t.includes('Por revisar')).toBe(true);
      expect(t).toContain('1 pedido sigue Por confirmar');
      expect(t).toContain('2 entregas siguen Pendientes');
      expect(t).toContain('Cancelados (no suman)');
      expect(t).toContain('Pendiente de pago');
      expect(t).toContain('Mensaje automático de Aelika');
    }
    expect(c.texto).toContain('$100.10');
    expect(c.html).not.toMatch(/https?:\/\//);
  });
  it('sin pendientes no hay bloque de revisión', () => {
    const c = construirCorreoResumen(
      'N',
      semana,
      calcularTotales([
        fila({ estado: 'COMPLETADO', estadosEntregas: ['ENTREGADA'] }),
      ]),
    );
    expect(c.texto).not.toContain('POR REVISAR');
    expect(c.html).not.toContain('Por revisar');
  });
  it('semana sin pedidos: correo corto «Sin pedidos esta semana»', () => {
    const c = construirCorreoResumen('N', semana, calcularTotales([]));
    expect(c.texto).toContain('Sin pedidos esta semana');
    expect(c.html).toContain('Sin pedidos esta semana');
    expect(c.texto).not.toContain('Cobranza'.toUpperCase());
  });
  it('escapa el HTML del nombre y deja el asunto en una sola línea', () => {
    const c = construirCorreoResumen(
      '<b>Evil</b>\nBcc: x@y.co',
      semana,
      calcularTotales([fila()]),
    );
    expect(c.asunto).not.toMatch(/[\r\n]/);
    expect(c.html).not.toContain('<b>Evil</b>');
    expect(c.html).toContain('&lt;b&gt;Evil&lt;/b&gt;');
  });
  it('nombre del archivo: negocio + semana, conserva acentos y quita caracteres inválidos', () => {
    expect(nombreArchivoResumen('Panadería/Ñandú: "Ñ"', semana)).toBe(
      'Pedidos PanaderíaÑandú Ñ 2026-10-26 al 2026-11-01.xlsx',
    );
    expect(nombreArchivoResumen('///', semana)).toBe(
      'Pedidos Negocio 2026-10-26 al 2026-11-01.xlsx',
    );
  });
});
