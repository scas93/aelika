import { describe, expect, it } from "vitest";
import type { DiaModificarPortal } from "./portal-api";
import {
  borradorInicial,
  entregasAEnviar,
  entregasVigentes,
  fechasCambiadas,
  lineasEfectivas,
  totalesEstimados,
} from "./portal-modificar-modelo";

const dia = (
  fecha: string,
  productos: { productId: string; cantidad: number }[] | null,
): DiaModificarPortal => ({
  fecha,
  diaSemana: "VIERNES",
  estado: "MODIFICABLE",
  motivo: null,
  limiteAt: null,
  entrega: productos
    ? {
        estado: "PENDIENTE",
        productos: productos.map((p) => ({
          ...p,
          nombre: p.productId,
          precioUnitario: 10,
        })),
      }
    : null,
});

const DIAS = [
  dia("2026-10-02", [{ productId: "A", cantidad: 2 }]),
  dia("2026-10-03", [{ productId: "A", cantidad: 3 }]),
  dia("2026-10-04", null),
];
const EDITABLES = new Set(["2026-10-02", "2026-10-03", "2026-10-04"]);

describe("modelo de modificar pedido", () => {
  it("sin cambios no manda nada", () => {
    const o = borradorInicial(DIAS);
    expect(entregasAEnviar(o, borradorInicial(DIAS), EDITABLES)).toEqual([]);
  });

  it("solo manda las fechas que cambiaron; quitar manda items vacío", () => {
    const o = borradorInicial(DIAS);
    const a = borradorInicial(DIAS);
    a["2026-10-03"].lineas = { A: 5 };
    a["2026-10-02"].quitado = true;
    expect(entregasAEnviar(o, a, EDITABLES)).toEqual([
      { fecha: "2026-10-02", items: [] },
      { fecha: "2026-10-03", items: [{ productId: "A", cantidad: 5 }] },
    ]);
  });

  it("un día nuevo con productos se manda; cantidades en 0 no cuentan", () => {
    const o = borradorInicial(DIAS);
    const a = borradorInicial(DIAS);
    a["2026-10-04"].lineas = { B: 1, C: 0 };
    expect(lineasEfectivas(a["2026-10-04"])).toEqual({ B: 1 });
    expect(entregasAEnviar(o, a, EDITABLES)).toEqual([
      { fecha: "2026-10-04", items: [{ productId: "B", cantidad: 1 }] },
    ]);
  });

  it("un día no editable nunca se manda, aunque cambie el borrador", () => {
    const o = borradorInicial(DIAS);
    const a = borradorInicial(DIAS);
    a["2026-10-02"].lineas = { A: 9 };
    expect(fechasCambiadas(o, a, new Set(["2026-10-03"]))).toEqual([]);
  });

  it("entregasVigentes cuenta los días con productos (para no dejar el pedido sin entregas)", () => {
    const a = borradorInicial(DIAS);
    expect(entregasVigentes(a)).toBe(2);
    a["2026-10-02"].quitado = true;
    a["2026-10-03"].lineas = { A: 0 };
    expect(entregasVigentes(a)).toBe(0);
  });

  it("totales estimados con descuento", () => {
    const a = borradorInicial(DIAS);
    const t = totalesEstimados(a, () => 10, 10);
    expect(t).toEqual({ subtotal: 50, descuento: 5, total: 45, piezas: 5 });
  });
});
