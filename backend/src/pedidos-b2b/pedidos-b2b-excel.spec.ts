import { repartirDescuento } from './pedidos-b2b-excel';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const suma = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe('repartirDescuento', () => {
  it('sin descuento o sin importe: todo en 0', () => {
    expect(repartirDescuento(0, [{ importe: 100, fecha: d('2026-10-05') }])).toStrictEqual([0]);
    expect(repartirDescuento(10, [{ importe: 0, fecha: d('2026-10-05') }])).toStrictEqual([0]);
    expect(repartirDescuento(10, [])).toStrictEqual([]);
  });

  it('una sola entrega se lleva todo el descuento', () => {
    expect(repartirDescuento(26.66, [{ importe: 533.28, fecha: d('2026-10-05') }])).toStrictEqual([26.66]);
  });

  it('reparto exacto cuando no hay que redondear', () => {
    const r = repartirDescuento(99.3, [
      { importe: 270, fecha: d('2026-10-05') },
      { importe: 270, fecha: d('2026-10-07') },
      { importe: 122, fecha: d('2026-10-09') },
    ]);
    expect(r).toStrictEqual([40.5, 40.5, 18.3]);
  });

  it('el redondeo ajusta UNA sola entrega: la de mayor importe; si empatan, la más reciente', () => {
    const r = repartirDescuento(26.66, [
      { importe: 199.98, fecha: d('2026-10-05') },
      { importe: 199.98, fecha: d('2026-10-07') },
      { importe: 133.32, fecha: d('2026-10-09') },
    ]);
    expect(r).toStrictEqual([10, 9.99, 6.67]);
    expect(suma(r)).toBe(26.66);
  });

  it('la suma siempre es exactamente el descuento del pedido (barrido de casos)', () => {
    const importes = [199.98, 199.98, 133.32].map((importe, n) => ({ importe, fecha: d(`2026-10-0${5 + n}`) }));
    for (let cent = 1; cent <= 20000; cent += 7) {
      const desc = cent / 100;
      expect(suma(repartirDescuento(desc, importes))).toBe(desc);
    }
    const raros = [0.01, 0.02, 0.03, 7.77, 1234.56].map((importe, n) => ({ importe, fecha: d(`2026-10-0${1 + n}`) }));
    for (const desc of [0.01, 0.02, 0.5, 3.33, 100]) {
      const partes = repartirDescuento(desc, raros);
      expect(suma(partes)).toBe(desc);
      partes.forEach((p) => expect(p).toBeGreaterThanOrEqual(0));
    }
  });
});
