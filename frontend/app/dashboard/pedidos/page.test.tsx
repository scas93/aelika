import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Order } from "@/lib/api";

vi.mock("@/lib/session-context", () => ({
  useSession: () => ({
    token: "t",
    user: { id: "u1", nombre: "Ana", rol: "OPERADOR", tenant: { nombre: "Entredós", ubicacion: null } },
  }),
}));

const fetchOrders = vi.fn();
const fetchPuntosEnvio = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchOrders, fetchPuntosEnvio };
});

const { default: PedidosPage } = await import("./page");

function pedido(items: { nombreProducto: string; nota?: string | null }[]): Order {
  return {
    id: "o1",
    tenantId: "t1",
    folio: "7",
    clienteNombre: "Luis",
    clienteTelefono: "5555555555",
    clienteCorreo: null,
    notas: null,
    metodoEntrega: "RECOGER",
    puntoEnvioId: null,
    horaRecogidaTipo: "LO_ANTES_POSIBLE",
    horaRecogida: null,
    metodoPago: "EFECTIVO",
    estadoPago: "PAGADO",
    estadoPedido: "PENDIENTE_CONFIRMACION",
    requiereFactura: false,
    descuentoTotal: "0",
    notasDescuento: null,
    total: "100",
    createdAt: "2026-10-21T16:00:00.000Z",
    updatedAt: "2026-10-21T16:00:00.000Z",
    canalOrigen: "WEB",
    items: items.map((i, n) => ({ id: `i${n}`, productId: `p${n}`, cantidad: 1, precioUnitario: "50", ...i })),
  } as unknown as Order;
}

async function abrirCard(o: Order) {
  fetchOrders.mockResolvedValue([o]);
  fetchPuntosEnvio.mockResolvedValue([]);
  render(<PedidosPage />);
  fireEvent.click(await screen.findByText("#7", { exact: false }));
}

describe("Pedidos del panel: nota por producto", () => {
  beforeEach(() => {
    fetchOrders.mockReset();
    fetchPuntosEnvio.mockReset();
  });
  afterEach(cleanup);

  it("la card muestra '↳ nota' debajo de la línea con nota y nada en las que no la tienen", async () => {
    await abrirCard(pedido([{ nombreProducto: "Latte", nota: "Extra caliente" }, { nombreProducto: "Pan" }]));
    await waitFor(() => expect(screen.getAllByText("↳ Extra caliente").length).toBeGreaterThan(0));
    // Una vez en la card y otra en la comanda imprimible oculta (respaldo window.print()).
    expect(document.querySelectorAll("#comanda-imprimible").length).toBe(1);
    expect(document.querySelector("#comanda-imprimible")!.textContent).toContain("↳ Extra caliente");
    expect(screen.getAllByText(/↳/)).toHaveLength(2);
  });

  it("sin nota por línea no aparece ninguna marca", async () => {
    await abrirCard(pedido([{ nombreProducto: "Latte", nota: null }, { nombreProducto: "Pan" }]));
    await screen.findAllByText(/Latte/);
    expect(screen.queryAllByText(/↳/)).toHaveLength(0);
  });
});
