import { describe, expect, it } from "vitest";
import {
  claseChipEstado,
  fechaPago,
  rangoSemana,
  rutaBasePortal,
  etiquetaSemanaRelativa,
  porSemanaAscendente,
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

// Hoy = miércoles 14 oct 2026 → semana actual: lunes 12 oct.
describe("etiquetaSemanaRelativa", () => {
  it("esta semana, próxima y ninguna en otro caso", () => {
    expect(etiquetaSemanaRelativa("2026-10-12", "2026-10-14")).toBe(
      "Esta semana",
    );
    expect(etiquetaSemanaRelativa("2026-10-19", "2026-10-14")).toBe(
      "Próxima semana",
    );
    expect(etiquetaSemanaRelativa("2026-10-05", "2026-10-14")).toBeNull();
    expect(etiquetaSemanaRelativa("2026-10-26", "2026-10-14")).toBeNull();
  });
  it("en domingo la semana en curso sigue siendo la del lunes anterior", () => {
    expect(etiquetaSemanaRelativa("2026-10-12", "2026-10-18")).toBe(
      "Esta semana",
    );
    expect(etiquetaSemanaRelativa("2026-10-19", "2026-10-18")).toBe(
      "Próxima semana",
    );
  });
});

describe("porSemanaAscendente", () => {
  it("ordena la semana más próxima primero sin mutar", () => {
    const l = [
      { folio: "B", semanaInicio: "2026-10-19" },
      { folio: "A", semanaInicio: "2026-10-12" },
    ];
    expect(porSemanaAscendente(l).map((p) => p.folio)).toEqual(["A", "B"]);
    expect(l[0].folio).toBe("B");
  });
});
