import { describe, it, expect } from "vitest";
import {
  entregaAbiertaPorDefecto,
  fechaCorta,
  montoCobrable,
  montoDeEntrega,
  piezasDeEntrega,
  resumenPorProducto,
  type EntregaVista,
} from "./entregas-vista";

const e = (id: string, fecha: string, estado: EntregaVista["estado"], extra: Partial<EntregaVista> = {}): EntregaVista => ({
  id,
  fecha,
  dia: "LUNES",
  estado,
  cerradaAt: null,
  atrasada: false,
  productos: [
    { nombreProducto: "Pan", cantidad: 10, precioUnitario: 12.5 },
    { nombreProducto: "Cuerno", cantidad: 2, precioUnitario: 30 },
  ],
  ...extra,
});

describe("entregas-vista", () => {
  it("piezas y monto de una entrega (antes del descuento)", () => {
    expect(piezasDeEntrega(e("a", "2026-10-19", "PENDIENTE"))).toBe(12);
    expect(montoDeEntrega(e("a", "2026-10-19", "PENDIENTE"))).toBe(185);
  });

  it("la suma de las entregas NO canceladas es lo cobrable", () => {
    const todas = [e("a", "2026-10-19", "ENTREGADA"), e("b", "2026-10-20", "PENDIENTE"), e("c", "2026-10-21", "CANCELADA")];
    expect(montoCobrable(todas)).toBe(370);
  });

  it("abierta por defecto: la atrasada; si no, la próxima pendiente; si todas cerradas o canceladas, ninguna", () => {
    expect(entregaAbiertaPorDefecto([e("a", "2026-10-19", "ENTREGADA"), e("b", "2026-10-20", "PENDIENTE"), e("c", "2026-10-21", "PENDIENTE")])).toBe("b");
    expect(entregaAbiertaPorDefecto([e("a", "2026-10-19", "PENDIENTE", { atrasada: true }), e("b", "2026-10-20", "PENDIENTE")])).toBe("a");
    expect(entregaAbiertaPorDefecto([e("a", "2026-10-19", "ENTREGADA"), e("b", "2026-10-20", "CANCELADA"), e("c", "2026-10-21", "NO_RECOGIDA")])).toBeNull();
    expect(entregaAbiertaPorDefecto([])).toBeNull();
  });

  it("resumen por producto: suma entre entregas y excluye las canceladas", () => {
    const r = resumenPorProducto([e("a", "2026-10-19", "ENTREGADA"), e("b", "2026-10-20", "PENDIENTE"), e("c", "2026-10-21", "CANCELADA")]);
    expect(r).toStrictEqual([
      { nombreProducto: "Pan", cantidad: 20, monto: 250 },
      { nombreProducto: "Cuerno", cantidad: 4, monto: 120 },
    ]);
  });

  it("fecha corta sin repetir el día, en UTC", () => {
    expect(fechaCorta("2026-10-21T00:00:00.000Z")).toBe("Mié 21 oct");
    expect(fechaCorta("2026-10-19T00:00:00.000Z", false)).toBe("19 oct");
  });
});
