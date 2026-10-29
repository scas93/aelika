import { describe, expect, it } from "vitest";
import { diasBloqueadosDeSemana } from "./dias-sin-entrega";

describe("diasBloqueadosDeSemana", () => {
  const lista = new Map<string, string | null>([
    ["2026-12-25", "Navidad"],
    ["2027-01-01", null],
  ]);

  it("mapea la fecha de cada festivo al día de la semana de ese pedido, con su nota", () => {
    // Semana del lunes 21-dic: el 25 es viernes. Llega como datetime ISO (así lo manda el servidor).
    const r = diasBloqueadosDeSemana("2026-12-21T00:00:00.000Z", lista);
    expect([...r]).toEqual([["VIERNES", "Navidad"]]);
  });

  it("no se recorre un día por la zona horaria: lunes 28-dic bloquea el 1-ene (viernes) y no el jueves", () => {
    const r = diasBloqueadosDeSemana("2026-12-28T00:00:00.000Z", lista);
    expect([...r]).toEqual([["VIERNES", null]]);
  });

  it("semanas sin festivos no bloquean nada", () => {
    expect(diasBloqueadosDeSemana("2026-10-05", lista).size).toBe(0);
  });

  it("un día donde el pedido ya tiene entrega no se bloquea (se puede editar o quitar)", () => {
    const r = diasBloqueadosDeSemana("2026-12-21", lista, new Set(["VIERNES"]));
    expect(r.size).toBe(0);
  });
});
