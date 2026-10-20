import { describe, it, expect } from "vitest";
import {
  entregaAbiertaPorDefecto,
  fechaCorta,
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
  it("abierta por defecto: la atrasada; si no, la próxima pendiente; si todas cerradas o canceladas, ninguna", () => {
    expect(entregaAbiertaPorDefecto([e("a", "2026-10-19", "ENTREGADA"), e("b", "2026-10-20", "PENDIENTE"), e("c", "2026-10-21", "PENDIENTE")])).toBe("b");
    expect(entregaAbiertaPorDefecto([e("a", "2026-10-19", "PENDIENTE", { atrasada: true }), e("b", "2026-10-20", "PENDIENTE")])).toBe("a");
    expect(entregaAbiertaPorDefecto([e("a", "2026-10-19", "ENTREGADA"), e("b", "2026-10-20", "CANCELADA"), e("c", "2026-10-21", "NO_RECOGIDA")])).toBeNull();
    expect(entregaAbiertaPorDefecto([])).toBeNull();
  });

  it("caso del 19 oct: semana del 19, sin entregas lun/mar, consultado el 19 → abre la próxima pendiente (Mié 21)", () => {
    // Ninguna atrasada (hoy = 19 oct); el servidor entrega las entregas ya ordenadas o no: la función no depende del orden.
    const entregas = [
      e("jue", "2026-10-22T00:00:00.000Z", "PENDIENTE"),
      e("mie", "2026-10-21T00:00:00.000Z", "PENDIENTE"),
      e("vie", "2026-10-23T00:00:00.000Z", "PENDIENTE"),
    ];
    expect(entregaAbiertaPorDefecto(entregas)).toBe("mie");
  });

  it("fecha corta sin repetir el día, en UTC", () => {
    expect(fechaCorta("2026-10-21T00:00:00.000Z")).toBe("Mié 21 oct");
    expect(fechaCorta("2026-10-19T00:00:00.000Z", false)).toBe("19 oct");
  });
});
