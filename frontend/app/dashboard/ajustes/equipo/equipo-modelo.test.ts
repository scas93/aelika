import { describe, it, expect } from "vitest";
import type { Role, TeamUser } from "@/lib/api";
import { opcionesCambioRol, ordenarEquipo, puedeActuarSobre, rolesAsignables } from "./equipo-modelo";

const u = (id: string, nombre: string, rol: Role, activo = true): TeamUser => ({
  id,
  nombre,
  email: `${id}@x.com`,
  rol,
  activo,
  createdAt: "2026-01-01T00:00:00Z",
});

describe("equipo-modelo", () => {
  it("ordena Admin, Gerente, Operador; alfabético dentro del grupo; inactivos al final", () => {
    const orden = ordenarEquipo([
      u("1", "Zoe", "OPERADOR"),
      u("2", "Ana", "OPERADOR"),
      u("3", "Beto", "GERENTE"),
      u("4", "Carla", "DUENO"),
      u("5", "Abel", "DUENO", false),
      u("6", "Dani", "GERENTE", false),
    ]);
    expect(orden.map((p) => p.nombre)).toStrictEqual(["Carla", "Beto", "Ana", "Zoe", "Abel", "Dani"]);
  });

  it("roles asignables: el Admin ofrece los 3; el Gerente nunca ofrece Admin", () => {
    expect(rolesAsignables("DUENO")).toStrictEqual(["OPERADOR", "GERENTE", "DUENO"]);
    expect(rolesAsignables("GERENTE")).toStrictEqual(["OPERADOR", "GERENTE"]);
  });

  it("menú: ninguno en la fila propia; el Gerente no lo tiene en filas de Admin; el Admin sí en las demás", () => {
    const admin = u("a", "Admin", "DUENO");
    const gerente = u("g", "Ger", "GERENTE");
    const operador = u("o", "Op", "OPERADOR");
    expect(puedeActuarSobre("DUENO", "a", admin)).toBe(false);
    expect(puedeActuarSobre("GERENTE", "g", gerente)).toBe(false);
    expect(puedeActuarSobre("GERENTE", "g", admin)).toBe(false);
    expect(puedeActuarSobre("GERENTE", "g", operador)).toBe(true);
    expect(puedeActuarSobre("DUENO", "a", gerente)).toBe(true);
    expect(puedeActuarSobre("DUENO", "a", u("b", "Otro Admin", "DUENO"))).toBe(true);
  });

  it("cambio de rol: opciones sin el rol actual de la persona", () => {
    expect(opcionesCambioRol("DUENO", u("o", "Op", "OPERADOR"))).toStrictEqual(["GERENTE", "DUENO"]);
    expect(opcionesCambioRol("DUENO", u("a", "Ad", "DUENO"))).toStrictEqual(["OPERADOR", "GERENTE"]);
    expect(opcionesCambioRol("GERENTE", u("o", "Op", "OPERADOR"))).toStrictEqual(["GERENTE"]);
    expect(opcionesCambioRol("GERENTE", u("g", "Ger", "GERENTE"))).toStrictEqual(["OPERADOR"]);
  });
});
