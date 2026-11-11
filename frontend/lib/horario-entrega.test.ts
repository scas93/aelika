import { describe, expect, it } from "vitest";
import type { HorarioSemana } from "./api";
import { diasDisponibles, duracionesDisponibles, entregaMasTemprana, formatoDuracion, horasDisponiblesParaFecha } from "./horario";

const abierto = { abierto: true, apertura: "09:00", cierre: "12:00" };
const cerrado = { abierto: false, apertura: null, cierre: null };
const HORARIO: HorarioSemana = {
  lunes: abierto,
  martes: abierto,
  miercoles: abierto,
  jueves: abierto,
  viernes: abierto,
  sabado: abierto,
  domingo: cerrado,
};
// Martes 2026-11-10 10:00 en Ciudad de México (16:00Z).
const AHORA = new Date("2026-11-10T16:00:00Z");

describe("reglas de entrega", () => {
  it("calcula el primer momento con anticipación", () => {
    expect(entregaMasTemprana(24 * 60, AHORA)).toEqual({ fecha: "2026-11-11", hora: "10:00" });
  });

  it("hoy ofrece horas cada 30 min desde ahora + margen", () => {
    expect(horasDisponiblesParaFecha(HORARIO, "2026-11-10", 15, AHORA)).toEqual(["10:30", "11:00", "11:30"]);
  });

  it("duraciones de hoy: pasos de 15 min desde el mínimo hasta antes del cierre", () => {
    // Son las 10:00 y cierra a las 12:00: de 15 min a 1 h 45 min.
    expect(duracionesDisponibles(HORARIO, 15, AHORA)).toEqual([15, 30, 45, 60, 75, 90, 105]);
    expect(duracionesDisponibles(HORARIO, 60, AHORA)[0]).toBe(60);
    expect(duracionesDisponibles(HORARIO, 24 * 60, AHORA)).toEqual([]);
  });

  it("con 24 h hoy no hay horas y mañana solo desde la hora actual", () => {
    expect(horasDisponiblesParaFecha(HORARIO, "2026-11-10", 24 * 60, AHORA)).toEqual([]);
    expect(horasDisponiblesParaFecha(HORARIO, "2026-11-11", 24 * 60, AHORA)).toEqual(["10:00", "10:30", "11:00", "11:30"]);
  });

  it("omite los días cerrados y la ventana cuenta desde el primer día disponible", () => {
    const dias = diasDisponibles(HORARIO, 6, 24 * 60, AHORA).map((d) => d.fecha);
    expect(dias[0]).toBe("2026-11-11");
    expect(dias).not.toContain("2026-11-15"); // domingo
    expect(dias.at(-1)).toBe("2026-11-17");
  });

  it("con 48 h los días bloqueados no ocupan lugar: 5 días visibles desde el primero disponible", () => {
    const dias = diasDisponibles(HORARIO, 6, 48 * 60, AHORA).map((d) => d.fecha);
    expect(dias[0]).toBe("2026-11-12");
    expect(dias).toHaveLength(6); // 12..18 sin el domingo 15
  });
});

describe("formatoDuracion", () => {
  it("muestra minutos, horas o ambos", () => {
    expect(formatoDuracion(15)).toBe("15 min");
    expect(formatoDuracion(120)).toBe("2 h");
    expect(formatoDuracion(75)).toBe("1 h 15 min");
  });
});
