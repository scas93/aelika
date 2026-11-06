import { describe, expect, it } from "vitest";
import { ultimasSemanas } from "./semanas-resumen";

describe("ultimasSemanas", () => {
  it("la primera es la semana anterior (lunes a domingo) y las demás van hacia atrás", () => {
    // Lunes 5 oct 2026 10:00 CDMX (16:00 UTC): la anterior es 28 sep – 4 oct.
    const s = ultimasSemanas(3, new Date("2026-10-05T16:00:00.000Z"));
    expect(s.map((x) => x.inicio)).toEqual(["2026-09-28", "2026-09-21", "2026-09-14"]);
    expect(s[0].etiqueta).toBe("28 sep – 4 oct 2026 (anterior)");
  });
  it("usa la fecha de CDMX, no la UTC (domingo 23:00 CDMX sigue siendo la semana en curso)", () => {
    const s = ultimasSemanas(1, new Date("2026-10-05T05:00:00.000Z"));
    expect(s[0].inicio).toBe("2026-09-21");
  });
});
