import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { PaginatedPedidosB2b, PedidoB2bReportable } from "@/lib/api";

vi.mock("@/lib/session-context", () => ({ useSession: () => ({ user: { rol: "GERENTE" }, token: "t" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard/pedidos-b2b/historico" }));
vi.mock("../detalle-panel", () => ({ default: ({ pedidoId }: { pedidoId: string | null }) => (pedidoId ? <div>panel {pedidoId}</div> : null) }));

const fetchPedidosB2b = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchPedidosB2b };
});

const { default: Historico } = await import("./page");

function fila(id: string, extra: Partial<PedidoB2bReportable> = {}): PedidoB2bReportable {
  return {
    id,
    folio: `P-00000${id}`,
    negocioNombre: `Negocio ${id}`,
    contactoNombre: "X",
    semanaInicio: "2026-10-12T00:00:00.000Z",
    estado: "COMPLETADO",
    estadoPago: "PAGADO",
    modoCobro: "AL_FINAL",
    cancelado: false,
    modificadoPorClienteAt: null,
    totalPiezas: 10,
    total: "450",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}
async function abrirFiltro(nombre: string) {
  fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${nombre}`) }));
}
const respuesta = (data: PedidoB2bReportable[], total = data.length): PaginatedPedidosB2b => ({ data, total, page: 1, limit: 25, totalPages: 1 });

describe("Históricos B2B", () => {
  beforeEach(() => fetchPedidosB2b.mockReset());
  afterEach(cleanup);

  it("al abrir carga el histórico solo (sin pulsar Buscar), con soloHistorico y sin filtros", async () => {
    fetchPedidosB2b.mockResolvedValue(respuesta([fila("1"), fila("2", { cancelado: true, estadoPago: "PENDIENTE", total: "0" })]));
    render(<Historico />);
    await screen.findByText("Negocio 1");
    expect(fetchPedidosB2b).toHaveBeenCalledTimes(1);
    expect(fetchPedidosB2b.mock.calls[0][1]).toMatchObject({ soloHistorico: true, page: 1, limit: 25 });
    expect(screen.queryByRole("button", { name: "Buscar" })).toBeNull();
    // El conteo va abajo, junto a la paginación (no arriba de la tabla)
    expect(screen.getByText("1–2 de 2 resultados")).toBeTruthy();
    expect(screen.queryByText("2 pedidos")).toBeNull();
    expect(screen.getByRole("button", { name: "Exportar Excel" })).toBeTruthy();
    // Columnas: Negocio, Semana, Estado, Pago, Total (el folio solo va en el Excel)
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toStrictEqual(["Negocio", "Semana", "Estado", "Pago", "Total"]);
    expect(screen.getByText("Cancelado")).toBeTruthy();
    // Un cancelado sin nada por cobrar no muestra «Pendiente» en Pago
    expect(screen.getAllByText("—")).toHaveLength(1);
    expect(screen.queryByText("Pendiente")).toBeNull();
    // La semana nunca se parte en dos líneas
    expect(screen.getAllByText(/oct/)[0].className).toContain("whitespace-nowrap");
  });

  it("un filtro de una sola elección abre la lista directo y aplica al elegir; activo se ve «Pago: Pagado ✕»", async () => {
    fetchPedidosB2b.mockResolvedValueOnce(respuesta([fila("1"), fila("2")]));
    render(<Historico />);
    await screen.findByText("Negocio 1");
    fetchPedidosB2b.mockResolvedValueOnce(respuesta([fila("2")]));
    await abrirFiltro("Pago");
    // Se abre directo la lista de opciones (sin select intermedio ni botón «Aplicar»); elegir aplica al instante.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
    fireEvent.click(await screen.findByRole("option", { name: "Pagado" }));
    await waitFor(() => expect(fetchPedidosB2b).toHaveBeenCalledTimes(2));
    expect(fetchPedidosB2b.mock.calls[1][1]).toMatchObject({ estadoPago: "PAGADO", soloHistorico: true, page: 1 });
    await screen.findByText("1–1 de 1 resultado");
    expect(screen.getByText("Pago: Pagado", { exact: false })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quitar filtro de Pago" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Limpiar filtros" })).toBeTruthy();
  });

  it("el buscador «Buscar negocio…» filtra por negocio al escribir", async () => {
    fetchPedidosB2b.mockResolvedValue(respuesta([fila("1")]));
    render(<Historico />);
    await screen.findByText("Negocio 1");
    fireEvent.change(screen.getByPlaceholderText("Buscar negocio…"), { target: { value: "aurora" } });
    await waitFor(() => expect(fetchPedidosB2b.mock.calls.at(-1)![1].negocioNombre).toBe("aurora"));
    // Borrar el texto quita la búsqueda (no es un chip: el buscador se limpia solo)
    fireEvent.change(screen.getByPlaceholderText("Buscar negocio…"), { target: { value: "" } });
    await waitFor(() => expect(fetchPedidosB2b.mock.calls.at(-1)![1].negocioNombre).toBeUndefined());
  });

  it("sin resultados con filtros: mensaje claro y «Limpiar filtros» (bajo la barra) que vuelve a la lista inicial", async () => {
    fetchPedidosB2b.mockResolvedValueOnce(respuesta([fila("1")]));
    render(<Historico />);
    await screen.findByText("Negocio 1");
    fetchPedidosB2b.mockResolvedValueOnce(respuesta([], 0));
    await abrirFiltro("Pago");
    fireEvent.click(await screen.findByRole("option", { name: "Pendiente" }));
    await screen.findByText("No hay pedidos que coincidan con estos filtros.");
    fetchPedidosB2b.mockResolvedValueOnce(respuesta([fila("1")]));
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    await screen.findByText("Negocio 1");
    expect(fetchPedidosB2b.mock.calls.at(-1)![1].estadoPago).toBeUndefined();
  });

  it("clic en una fila abre el panel del pedido", async () => {
    fetchPedidosB2b.mockResolvedValue(respuesta([fila("7")]));
    render(<Historico />);
    fireEvent.click(await screen.findByText("Negocio 7"));
    expect(await screen.findByText("panel 7")).toBeTruthy();
  });
});
