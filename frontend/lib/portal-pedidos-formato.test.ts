import { describe, expect, it } from "vitest";
import {
  claseChipEstado,
  fechaPago,
  rangoSemana,
  rutaBasePortal,
} from "./portal-pedidos-formato";

describe("formato de Ver mis pedidos", () => {
  it("rangoSemana no se desfasa por zona horaria", () => {
    expect(rangoSemana("2026-09-28", "2026-10-04")).toBe("28 sep – 4 oct");
  });

  it("fechaPago usa la fecha de Ciudad de México", () => {
    // 02:00 UTC del 2 de octubre sigue siendo 1 de octubre en CDMX
    expect(fechaPago("2026-10-02T02:00:00.000Z")).toContain("1");
    expect(fechaPago("2026-10-02T02:00:00.000Z")).toContain("oct");
  });

  it("rutaBasePortal funciona con y sin el prefijo /mayoreo", () => {
    expect(
      rutaBasePortal("/mayoreo/banetto/portal/pedidos/P-000001", "banetto"),
    ).toBe("/mayoreo/banetto");
    expect(rutaBasePortal("/banetto/portal/pedidos", "banetto")).toBe(
      "/banetto",
    );
    expect(rutaBasePortal("/otra-ruta", "banetto")).toBe("/mayoreo/banetto");
  });

  it("claseChipEstado distingue cancelado y completado", () => {
    expect(claseChipEstado("CANCELADO")).toContain("red");
    expect(claseChipEstado("COMPLETADO")).toContain("green");
    expect(claseChipEstado("PENDIENTE_CONFIRMACION")).toContain("accent");
  });
});
