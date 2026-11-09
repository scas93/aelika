import { describe, it, expect } from "vitest";
import type { PedidoB2bCambios } from "@/lib/api";
import { contenidoSeccion, etiquetaLinea, TEXTO_SIN_DETALLE, TEXTO_SIN_DIFERENCIAS, textosCambios } from "./cambios-vista";

const vacio: PedidoB2bCambios = { entregas: [], nota: null, total: null, soloPrecios: false, sinDiferencias: false };

describe("textosCambios", () => {
  it("lista breve, por fecha de entrega, en lenguaje simple (nota y total al final)", () => {
    const c: PedidoB2bCambios = {
      ...vacio,
      entregas: [
        { tipo: "ELIMINADA", fecha: "2026-11-10", piezas: 3, lineas: [] },
        {
          tipo: "MODIFICADA",
          fecha: "2026-11-11",
          piezas: 15,
          lineas: [
            { productId: "a", nombreProducto: "Croissant de Almendra", tipo: "CAMBIO", antes: 4, despues: 6 },
            { productId: "b", nombreProducto: "Facturita de Pistache", tipo: "NUEVO", antes: null, despues: 5 },
          ],
        },
        { tipo: "MODIFICADA", fecha: "2026-11-13", piezas: 1, lineas: [{ productId: "c", nombreProducto: "Rol de Canela", tipo: "ELIMINADO", antes: 2, despues: null }] },
        { tipo: "NUEVA", fecha: "2026-11-14", piezas: 12, lineas: [] },
      ],
      nota: "NUEVA",
      total: { antes: "11900.00", despues: "12570.40" },
    };
    expect(textosCambios(c)).toEqual([
      "Entrega eliminada: mar 10 nov",
      "Mié 11 nov · Croissant de Almendra: 4 → 6 piezas",
      "Mié 11 nov · Facturita de Pistache: nuevo (5)",
      "Vie 13 nov · Rol de Canela: eliminado",
      "Entrega nueva: sáb 14 nov (12 piezas)",
      "Nota del cliente: nueva",
      "Total: $11,900.00 → $12,570.40",
    ]);
  });

  it("entrega movida, nota modificada/quitada y una sola pieza", () => {
    expect(textosCambios({ ...vacio, entregas: [{ tipo: "MOVIDA", fecha: "2026-11-14", fechaAnterior: "2026-11-10", piezas: 1, lineas: [] }], nota: "QUITADA" })).toEqual([
      "Entrega movida de mar 10 nov a sáb 14 nov (1 pieza)",
      "Nota del cliente: quitada",
    ]);
    expect(textosCambios({ ...vacio, nota: "MODIFICADA" })).toEqual(["Nota del cliente: modificada"]);
  });

  it("solo precios: una frase clara y ningún cambio de productos", () => {
    expect(textosCambios({ ...vacio, soloPrecios: true, total: { antes: "100.00", despues: "110.00" } })).toEqual([
      "El total cambió por actualización de precios ($100.00 → $110.00)",
    ]);
  });
});

describe("contenidoSeccion y etiquetas", () => {
  it("NINGUNO o sin respuesta: no se muestra la sección", () => {
    expect(contenidoSeccion(null)).toBeNull();
    expect(contenidoSeccion({ estado: "NINGUNO", cambios: null })).toBeNull();
  });
  it("sin referencia y sin diferencias tienen su texto", () => {
    expect(contenidoSeccion({ estado: "SIN_DETALLE", cambios: null })).toEqual({ textos: [TEXTO_SIN_DETALLE], sinDetalle: true });
    expect(contenidoSeccion({ estado: "SIN_DIFERENCIAS", cambios: null })).toEqual({ textos: [TEXTO_SIN_DIFERENCIAS], sinDetalle: false });
    expect(TEXTO_SIN_DIFERENCIAS).toBe("Sin diferencias frente a la última revisión");
  });
  it("etiquetas de línea", () => {
    expect(etiquetaLinea({ productId: "a", nombreProducto: "A", tipo: "NUEVO", antes: null, despues: 5 })).toBe("Nuevo");
    expect(etiquetaLinea({ productId: "a", nombreProducto: "A", tipo: "CAMBIO", antes: 4, despues: 6 })).toBe("Cambió 4 → 6");
    expect(etiquetaLinea({ productId: "a", nombreProducto: "A", tipo: "ELIMINADO", antes: 4, despues: null })).toBe("Eliminado");
  });
});
