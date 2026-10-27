import { describe, it, expect } from "vitest";
import { buildComandaBytes, type ComandaContext } from "./thermal-printer";
import type { Order } from "./api";

const ctx: ComandaContext = {
  nombreNegocio: "Entredós",
  ubicacionNegocio: null,
  nombrePuntoEnvio: undefined,
  impresoPor: { nombre: "Ana", rol: "OPERADOR" },
};

function pedido(items: { nombreProducto: string; nota?: string | null }[]): Order {
  return {
    id: "o1",
    folio: "7",
    clienteNombre: "Luis",
    clienteTelefono: "5555555555",
    metodoEntrega: "RECOGER",
    horaRecogidaTipo: "LO_ANTES_POSIBLE",
    horaRecogida: null,
    metodoPago: "EFECTIVO",
    descuentoTotal: "0",
    total: "100",
    notas: null,
    createdAt: "2026-10-21T16:00:00.000Z",
    items: items.map((i, n) => ({ id: `i${n}`, productId: `p${n}`, cantidad: 1, precioUnitario: "50", ...i })),
  } as unknown as Order;
}

const texto = (o: Order) => new TextDecoder("latin1").decode(buildComandaBytes(o, ctx));

describe("Comanda WebUSB: nota por producto", () => {
  it("imprime la nota debajo de su línea y no marca las que no tienen", () => {
    const t = texto(pedido([{ nombreProducto: "Latte", nota: "Extra caliente" }, { nombreProducto: "Pan" }]));
    expect(t).toContain(">> Extra caliente");
    expect(t.indexOf("Latte")).toBeLessThan(t.indexOf(">> Extra caliente"));
    expect(t.indexOf(">> Extra caliente")).toBeLessThan(t.indexOf("Pan"));
    expect(t.match(/>>/g)).toHaveLength(1);
  });

  it("sin nota por línea, los bytes son idénticos a los de un pedido cuyos ítems no traen el campo", () => {
    const sinCampo = buildComandaBytes(pedido([{ nombreProducto: "Latte" }]), ctx);
    const nula = buildComandaBytes(pedido([{ nombreProducto: "Latte", nota: null }]), ctx);
    const vacia = buildComandaBytes(pedido([{ nombreProducto: "Latte", nota: "" }]), ctx);
    expect(Array.from(nula)).toStrictEqual(Array.from(sinCampo));
    expect(Array.from(vacia)).toStrictEqual(Array.from(sinCampo));
    expect(texto(pedido([{ nombreProducto: "Latte" }]))).not.toContain(">>");
  });
});
