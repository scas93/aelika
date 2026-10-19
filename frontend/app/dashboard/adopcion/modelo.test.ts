import { describe, expect, it } from "vitest";
import type { AdopcionClienteFila } from "@/lib/api";
import { desplazarSemana, filtrarClientes, formatoHoras, ordenarClientes } from "./modelo";
import { getNavItems } from "../nav-items";

function fila(p: Partial<AdopcionClienteFila> & { id: string; nombre: string }): AdopcionClienteFila {
  return {
    codigo: null,
    estado: "NO_HA_PEDIDO",
    etapa: "SIN_ACTIVIDAD",
    ultimoAccesoAt: null,
    primerPedidoAt: null,
    pedidosUltimas4Semanas: 0,
    modificadoSinReconfirmar: false,
    pedidoId: null,
    folio: null,
    origen: { casos: 0, portal: 0, panel: 0, porcentajePortal: null, porcentajePanel: null },
    ...p,
  };
}

describe("filtrarClientes", () => {
  const filas = [fila({ id: "1", nombre: "Café Aurora" }), fila({ id: "2", nombre: "Panadería Boreal" })];
  it("busca por nombre sin importar acentos ni mayúsculas", () => {
    expect(filtrarClientes(filas, "cafe").map((f) => f.id)).toEqual(["1"]);
    expect(filtrarClientes(filas, "PANADERIA").map((f) => f.id)).toEqual(["2"]);
    expect(filtrarClientes(filas, "  ")).toHaveLength(2);
    expect(filtrarClientes(filas, "zzz")).toEqual([]);
  });
});

describe("ordenarClientes", () => {
  const a = fila({ id: "a", nombre: "Ana", ultimoAccesoAt: "2026-10-01T00:00:00.000Z", pedidosUltimas4Semanas: 1 });
  const b = fila({ id: "b", nombre: "Beto", ultimoAccesoAt: null, pedidosUltimas4Semanas: 3 });
  const c = fila({ id: "c", nombre: "Carla", ultimoAccesoAt: "2026-10-05T00:00:00.000Z", pedidosUltimas4Semanas: 2 });

  it("sin orden elegido conserva el del servidor", () => {
    expect(ordenarClientes([c, a, b], null).map((f) => f.id)).toEqual(["c", "a", "b"]);
  });
  it("ordena por columna y deja los vacíos siempre al final", () => {
    expect(ordenarClientes([c, a, b], { clave: "ultimoAcceso", dir: "desc" }).map((f) => f.id)).toEqual(["c", "a", "b"]);
    expect(ordenarClientes([c, a, b], { clave: "ultimoAcceso", dir: "asc" }).map((f) => f.id)).toEqual(["a", "c", "b"]);
    expect(ordenarClientes([c, a, b], { clave: "pedidos", dir: "desc" }).map((f) => f.id)).toEqual(["b", "c", "a"]);
    expect(ordenarClientes([c, b, a], { clave: "nombre", dir: "asc" }).map((f) => f.id)).toEqual(["a", "b", "c"]);
  });
  it("por estado pone primero a los habituales que no han pedido", () => {
    const h = fila({ id: "h", nombre: "Zeta", estado: "NO_HA_PEDIDO_HABITUAL" });
    const p = fila({ id: "p", nombre: "Alfa", estado: "PIDIO" });
    expect(ordenarClientes([p, h], { clave: "estado", dir: "asc" }).map((f) => f.id)).toEqual(["h", "p"]);
  });
});

describe("formato", () => {
  it("horas", () => {
    expect(formatoHoras(5)).toBe("5 h");
    expect(formatoHoras(24)).toBe("1 d");
    expect(formatoHoras(30)).toBe("1 d 6 h");
  });
  it("desplaza la semana de lunes a lunes", () => {
    expect(desplazarSemana("2026-10-05", -1)).toBe("2026-09-28");
    expect(desplazarSemana("2026-10-05", 1)).toBe("2026-10-12");
  });
});

describe("menú: Adopción", () => {
  const visible = (rol: "OPERADOR" | "GERENTE" | "DUENO", tipo: "RETAIL_B2B" | "RETAIL_B2C") =>
    getNavItems(rol, tipo).some((i) => i.href === "/dashboard/adopcion");
  it("solo el Dueño de un negocio de mayoreo lo ve", () => {
    expect(visible("DUENO", "RETAIL_B2B")).toBe(true);
    expect(visible("GERENTE", "RETAIL_B2B")).toBe(false);
    expect(visible("OPERADOR", "RETAIL_B2B")).toBe(false);
    expect(visible("DUENO", "RETAIL_B2C")).toBe(false);
  });
});
