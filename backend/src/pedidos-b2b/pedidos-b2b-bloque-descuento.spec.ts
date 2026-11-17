import { bloquesDePedido, etiquetaDescuento } from './pedidos-b2b-bloque-descuento';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const centavos = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100);

describe('bloquesDePedido', () => {
  it('con descuento: Subtotal − Descuento = Total y Σ de las entregas = el pedido, al centavo', () => {
    const b = bloquesDePedido({
      entregas: [
        { importe: 50, fecha: d('2026-10-27') },
        { importe: 70, fecha: d('2026-10-29') },
      ],
      descuentoTotal: 12,
      total: 108,
      porcentaje: 10,
    });
    expect(b).toMatchObject({ subtotal: 120, descuento: 12, total: 108, porcentaje: 10 });
    expect(b.entregas.map((e) => e.descuento)).toEqual([5, 7]);
    expect(b.entregas.map((e) => e.total)).toEqual([45, 63]);
  });

  it('el centavo sobrante cuadra con importes que no dividen exacto: Σ descuentos y Σ totales exactos', () => {
    const importes = [33.33, 33.33, 33.34, 10.01, 0.99];
    const sub = importes.reduce((a, b) => a + b, 0);
    for (const desc of [0.01, 3.33, 9.99, 17.5, 25.01]) {
      const total = Math.round((sub - desc) * 100) / 100;
      const b = bloquesDePedido({
        entregas: importes.map((importe, i) => ({ importe, fecha: d(`2026-10-${20 + i}`) })),
        descuentoTotal: desc,
        total,
        porcentaje: null,
      });
      expect(centavos(b.entregas.map((e) => e.descuento))).toBe(Math.round(desc * 100));
      expect(centavos(b.entregas.map((e) => e.total))).toBe(Math.round(total * 100));
      for (const e of b.entregas) expect(centavos([e.subtotal - e.descuento])).toBe(Math.round(e.total * 100));
    }
  });

  it('sin descuento: descuento 0, porcentaje 0 y totales = subtotales', () => {
    const b = bloquesDePedido({
      entregas: [{ importe: 80, fecha: d('2026-10-27') }],
      descuentoTotal: 0,
      total: 80,
      porcentaje: null,
    });
    expect(b).toMatchObject({ subtotal: 80, descuento: 0, total: 80, porcentaje: 0 });
    expect(b.entregas).toEqual([{ subtotal: 80, descuento: 0, total: 80 }]);
  });

  it('descuento de monto fijo (sin %): porcentaje efectivo; el % guardado manda si existe', () => {
    const base = { entregas: [{ importe: 200, fecha: d('2026-10-27') }], descuentoTotal: 15, total: 185 };
    expect(bloquesDePedido({ ...base, porcentaje: null }).porcentaje).toBe(7.5);
    expect(bloquesDePedido({ ...base, porcentaje: 0 }).porcentaje).toBe(7.5);
    expect(bloquesDePedido({ ...base, porcentaje: 7.5 }).porcentaje).toBe(7.5);
  });

  it('dato heredado inconsistente: el Total guardado no cambia y el descuento se deriva (mínimo 0)', () => {
    const e = [{ importe: 120, fecha: d('2026-10-27') }];
    expect(bloquesDePedido({ entregas: e, descuentoTotal: 0, total: 100, porcentaje: null })).toMatchObject({
      descuento: 20,
      total: 100,
    });
    expect(bloquesDePedido({ entregas: e, descuentoTotal: 5, total: 130, porcentaje: null }).descuento).toBe(0);
  });

  it('sin entregas: todo en cero', () => {
    expect(bloquesDePedido({ entregas: [], descuentoTotal: 0, total: 0, porcentaje: null })).toMatchObject({
      subtotal: 0,
      descuento: 0,
      total: 0,
      entregas: [],
    });
  });
});

describe('etiquetaDescuento', () => {
  it('muestra el porcentaje sin ceros de sobra', () => {
    expect(etiquetaDescuento(10)).toBe('Descuento (10%)');
    expect(etiquetaDescuento(7.5)).toBe('Descuento (7.5%)');
    expect(etiquetaDescuento(33.333)).toBe('Descuento (33.33%)');
  });
});
