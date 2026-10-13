import { describe, expect, it } from "vitest";
import { lineaDias } from "./tarjeta-pedido";

describe("lineaDias", () => {
  it("hasta 4 días los muestra todos", () => {
    expect(lineaDias(["2026-10-19", "2026-10-21", "2026-10-23"], 66)).toBe(
      "Lun 19 · Mié 21 · Vie 23 · 66 pzas",
    );
    expect(
      lineaDias(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"], 8),
    ).toBe("Lun 19 · Mar 20 · Mié 21 · Jue 22 · 8 pzas");
  });
  it("con más de 4 días, los primeros 3 y «+N»", () => {
    expect(
      lineaDias(
        ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"],
        30,
      ),
    ).toBe("Lun 19 · Mar 20 · Mié 21 · +2 · 30 pzas");
  });
});
