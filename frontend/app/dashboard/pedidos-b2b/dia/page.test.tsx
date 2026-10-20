import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PedidoB2bEntregaDia } from "@/lib/api";

let rol = "GERENTE";
vi.mock("@/lib/session-context", () => ({ useSession: () => ({ user: { rol, nombre: "Ana", tenant: { nombre: "Panadería" } }, token: "t" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard/pedidos-b2b/dia" }));
vi.mock("../detalle-panel", () => ({ default: ({ pedidoId }: { pedidoId: string | null }) => (pedidoId ? <div>panel {pedidoId}</div> : null) }));

const fetchPedidosB2bDia = vi.fn();
const cerrarEntregaPedidoB2b = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchPedidosB2bDia, cerrarEntregaPedidoB2b, exportPedidosB2bDiaXlsx: vi.fn() };
});
const imprimir = vi.fn();
vi.mock("@/lib/thermal-printer", () => ({ isWebUsbSupported: () => true, printComandaB2bDiaWebUsb: (...a: unknown[]) => imprimir(...a) }));

const { default: DiaPage } = await import("./page");

function entrega(id: string, negocio: string, estado: PedidoB2bEntregaDia["entregaEstado"], items: [string, number][], extra: Partial<PedidoB2bEntregaDia> = {}): PedidoB2bEntregaDia {
  return {
    id,
    folio: `P-${id}`,
    negocioNombre: negocio,
    contactoNombre: "X",
    contactoTelefono: "5511112222",
    estado: "CONFIRMADO_SURTIENDO",
    cancelado: false,
    entregaId: `e${id}`,
    entregaEstado: estado,
    cerradaAt: null,
    atrasada: false,
    items: items.map(([nombreProducto, cantidad]) => ({ productId: `p-${nombreProducto}`, nombreProducto, precioUnitario: "10", cantidad })),
    ...extra,
  };
}

const DIA = [
  entrega("1", "Café A", "ENTREGADA", [["Pan", 10]]),
  entrega("2", "Café B", "PENDIENTE", [["Pan", 5], ["Cuerno", 20]]),
  entrega("3", "Café C", "NO_RECOGIDA", [["Cuerno", 3]]),
  entrega("4", "Café D", "LISTA", [["Pan", 1]], { atrasada: true }),
];

describe("Entregas del día (B2B)", () => {
  beforeEach(() => {
    rol = "GERENTE";
    fetchPedidosB2bDia.mockReset();
    cerrarEntregaPedidoB2b.mockReset();
    imprimir.mockReset();
    fetchPedidosB2bDia.mockResolvedValue(DIA);
  });
  afterEach(cleanup);

  it("sin «Total por producto» ni contador; tabla con pendientes/listas primero", async () => {
    render(<DiaPage />);
    await screen.findByText("Café A");
    expect(screen.queryByText(/Total por producto/)).toBeNull();
    expect(screen.queryByText(/entregas ·/)).toBeNull();
    const nombres = screen.getAllByRole("button", { name: /^Café/ }).map((b) => b.textContent);
    expect(nombres).toStrictEqual(["Café B", "Café D", "Café A", "Café C"]);
  });

  it("el selector de día usa referencia relativa", async () => {
    render(<DiaPage />);
    await screen.findByText("Café A");
    expect(screen.getByText(/^Hoy · /)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Día siguiente" }));
    expect(await screen.findByText(/^Mañana · /)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));
    fireEvent.click(screen.getByRole("button", { name: "Día anterior" }));
    expect(await screen.findByText(/^Ayer · /)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Día anterior" }));
    expect(await screen.findByText(/^[a-záéíóúñ]+ \d+ [a-z]+$/i)).toBeTruthy();
  });

  it("clic en el nombre abre el panel del pedido (sin desplegar la fila)", async () => {
    render(<DiaPage />);
    fireEvent.click(await screen.findByText("Café B"));
    expect(await screen.findByText("panel 2")).toBeTruthy();
    expect(screen.queryByText("20")).toBeNull(); // la fila no se desplegó
  });

  it("«Entregada» a la vista solo en entregas abiertas; cerrar llama al mismo endpoint y recarga", async () => {
    cerrarEntregaPedidoB2b.mockResolvedValue({});
    render(<DiaPage />);
    await screen.findByText("Café B");
    expect(screen.getAllByRole("button", { name: "Entregada" })).toHaveLength(2); // B y D (abiertas)
    fireEvent.click(screen.getAllByRole("button", { name: "Entregada" })[0]);
    await waitFor(() => expect(cerrarEntregaPedidoB2b).toHaveBeenCalledWith("t", "2", "e2", "ENTREGADA"));
    expect(fetchPedidosB2bDia).toHaveBeenCalledTimes(2);
  });

  it("acciones visibles por fila: [Entregada][No recogida] en entregas abiertas e Imprimir siempre al final", async () => {
    cerrarEntregaPedidoB2b.mockResolvedValue({});
    render(<DiaPage />);
    await screen.findByText("Café B");
    expect(screen.queryByRole("button", { name: "Más acciones" })).toBeNull(); // sin menú «⋯» en computadora
    expect(screen.getAllByRole("button", { name: "Imprimir" })).toHaveLength(4); // una por fila
    expect(screen.getAllByRole("button", { name: "No recogida" })).toHaveLength(2); // B y D (abiertas)
    fireEvent.click(screen.getAllByRole("button", { name: "No recogida" })[0]);
    await waitFor(() => expect(cerrarEntregaPedidoB2b).toHaveBeenCalledWith("t", "2", "e2", "NO_RECOGIDA"));
    // orden dentro de la fila de Café B: Entregada, No recogida, Imprimir
    const fila = screen.getByText("Café B").closest("tr")!;
    const nombres = [...fila.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim());
    expect(nombres.slice(-3)).toStrictEqual(["Entregada", "No recogida", "Imprimir"]);
  });

  it("pedido sin confirmar: solo Imprimir (sin «Confirmar pedido» ni cierre), para cualquier rol", async () => {
    fetchPedidosB2bDia.mockResolvedValue([
      entrega("5", "Café E", "PENDIENTE", [["Pan", 2]], { estado: "PENDIENTE_CONFIRMACION" }),
      entrega("7", "Café G", "PENDIENTE", [["Pan", 9]]),
    ]);
    render(<DiaPage />);
    await screen.findByText("Café E");
    expect(screen.getAllByText("Sin confirmar")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Confirmar pedido" })).toBeNull();
    const filaE = screen.getByText("Café E").closest("tr")!;
    expect(within(filaE).queryByRole("button", { name: "Entregada" })).toBeNull();
    expect(within(filaE).getByRole("button", { name: "Imprimir" })).toBeTruthy();
  });

  it("entrega cerrada: solo Imprimir", async () => {
    render(<DiaPage />);
    await screen.findByText("Café A");
    const filaA = screen.getByText("Café A").closest("tr")!; // ENTREGADA
    expect(within(filaA).queryByRole("button", { name: "No recogida" })).toBeNull();
    expect(within(filaA).getByRole("button", { name: "Imprimir" })).toBeTruthy();
  });

  it("productos al desplegar: orden alfabético, nombre bajo Negocio y cantidad bajo Piezas", async () => {
    render(<DiaPage />);
    await screen.findByText("Café B");
    fireEvent.click(screen.getByText("Café B").closest("tr")!); // Pan 5, Cuerno 20
    const filas = screen.getAllByRole("row");
    const i = filas.findIndex((r) => r.textContent?.includes("Café B"));
    const cuerno = filas[i + 1];
    const pan = filas[i + 2];
    expect(cuerno.textContent).toContain("Cuerno");
    expect(pan.textContent).toContain("Pan");
    expect(within(cuerno).getAllByRole("cell")).toHaveLength(4); // mismas columnas; Estado y Acciones vacías
    expect(within(cuerno).getAllByRole("cell")[1].textContent).toBe("20");
    expect(within(cuerno).getAllByRole("cell")[3].textContent).toBe("");
  });

  it("«Imprimir todo» imprime cada entrega del día, una tras otra; «Imprimir» de la fila solo la suya", async () => {
    imprimir.mockResolvedValue(undefined);
    render(<DiaPage />);
    await screen.findByText("Café B");
    fireEvent.click(screen.getByRole("button", { name: "Imprimir todo" }));
    await waitFor(() => expect(imprimir).toHaveBeenCalledTimes(4));
    expect(imprimir.mock.calls.map((c) => (c[0] as PedidoB2bEntregaDia).negocioNombre)).toStrictEqual(["Café B", "Café D", "Café A", "Café C"]);
    imprimir.mockClear();
    fireEvent.click(screen.getAllByRole("button", { name: "Imprimir" })[0]);
    await waitFor(() => expect(imprimir).toHaveBeenCalledTimes(1));
  });

  it("botón «Hoy» solo en otro día; sin entregas: mensaje vacío", async () => {
    fetchPedidosB2bDia.mockResolvedValue([]);
    render(<DiaPage />);
    await screen.findByText("No hay entregas programadas para este día.");
    expect(screen.queryByRole("button", { name: "Hoy" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Día siguiente" }));
    expect(await screen.findByRole("button", { name: "Hoy" })).toBeTruthy();
  });
});
