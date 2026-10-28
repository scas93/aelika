import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PedidoB2bReportable } from "@/lib/api";

vi.mock("@/lib/session-context", () => ({ useSession: () => ({ user: { rol: "GERENTE" }, token: "t" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard/pedidos-b2b" }));
vi.mock("./detalle-panel", () => ({ default: ({ pedidoId }: { pedidoId: string | null }) => (pedidoId ? <div>panel {pedidoId}</div> : null) }));
vi.mock("./nuevo-pedido-panel", () => ({ default: () => null }));

const fetchPedidosB2b = vi.fn();
const fetchPedidosB2bResumen = vi.fn();
const exportPedidosB2bXlsx = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchPedidosB2b, fetchPedidosB2bResumen, exportPedidosB2bXlsx };
});

const { default: PedidosB2bPage } = await import("./page");

function pedido(id: string, extra: Partial<PedidoB2bReportable> = {}): PedidoB2bReportable {
  return {
    id,
    folio: `P-${id}`,
    negocioNombre: `Negocio ${id}`,
    contactoNombre: "X",
    semanaInicio: "2026-10-19T00:00:00.000Z",
    estado: "PENDIENTE_CONFIRMACION",
    estadoPago: "PENDIENTE",
    modoCobro: "AL_FINAL",
    cancelado: false,
    modificadoPorClienteAt: null,
    totalPiezas: 10,
    total: "450",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

function datos(semanaActual: PedidoB2bReportable[], anteriores: PedidoB2bReportable[] = []) {
  fetchPedidosB2bResumen.mockResolvedValue({
    semanaEnCurso: { inicio: "2026-10-19", fin: "2026-10-25" },
    proximaSemana: { inicio: "2026-10-26", fin: "2026-11-01" },
  });
  fetchPedidosB2b.mockImplementation(async (_t: string, f: { semanaAntesDe?: string }) => {
    const data = f.semanaAntesDe ? anteriores : semanaActual;
    return { data, total: data.length, page: 1, limit: 100, totalPages: 1 };
  });
}

describe("Pedidos activos B2B (tabla)", () => {
  beforeEach(() => {
    fetchPedidosB2b.mockReset();
    fetchPedidosB2bResumen.mockReset();
    exportPedidosB2bXlsx.mockReset();
  });
  afterEach(cleanup);

  it("tabla con Negocio, Estado, Pago y Total (sin piezas ni semana); clic abre el panel", async () => {
    datos([pedido("1"), pedido("2", { estado: "CONFIRMADO_SURTIENDO", estadoPago: "PAGADO", total: "1200" })]);
    render(<PedidosB2bPage />);
    await screen.findByText("Negocio 1");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toStrictEqual(["Negocio", "Estado", "Pago", "Total"]);
    expect(screen.queryByText(/piezas/)).toBeNull();
    expect(screen.getByText("Por confirmar")).toBeTruthy();
    expect(screen.getByText("Confirmado")).toBeTruthy();
    expect(screen.getByText("Pagado")).toBeTruthy();
    fireEvent.click(screen.getByText("Negocio 2"));
    expect(await screen.findByText("panel 2")).toBeTruthy();
  });

  it("?pedido=<id> abre el panel de ese pedido aunque no esté en la semana mostrada (p. ej. la siguiente)", async () => {
    datos([pedido("1")]);
    window.history.pushState({}, "", "/dashboard/pedidos-b2b?pedido=de-la-semana-siguiente");
    try {
      render(<PedidosB2bPage />);
      expect(await screen.findByText("panel de-la-semana-siguiente")).toBeTruthy();
      await screen.findByText("Negocio 1");
    } finally {
      window.history.pushState({}, "", "/");
    }
  });

  it("«Modificado por el cliente» se ve como badge junto al nombre del negocio", async () => {
    datos([pedido("1", { modificadoPorClienteAt: "2026-10-19T10:00:00.000Z" }), pedido("2")]);
    render(<PedidosB2bPage />);
    await screen.findByText("Negocio 1");
    expect(screen.getAllByText("Modificado por el cliente")).toHaveLength(1);
  });

  it("filtros Estado, Pago y Negocio aplican sobre la semana; chips y «Limpiar filtros»", async () => {
    datos([pedido("1"), pedido("2", { estado: "CONFIRMADO_SURTIENDO", estadoPago: "PAGADO" })]);
    render(<PedidosB2bPage />);
    await screen.findByText("Negocio 1");
    expect(screen.queryByPlaceholderText("Buscar por negocio…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    fireEvent.click(screen.getByRole("button", { name: /^Negocio/ }));
    fireEvent.change(screen.getByPlaceholderText("Buscar negocio…"), { target: { value: "2" } });
    expect(screen.queryByText("Negocio 1")).toBeNull();
    expect(screen.getByText("Negocio 2")).toBeTruthy();
    expect(screen.getByText("Negocio: 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(screen.getByText("Negocio 1")).toBeTruthy();
  });

  it("Estado de selección múltiple: dos estados se combinan con O; sin ninguno marcado se ven todos", async () => {
    datos([
      pedido("1"),
      pedido("2", { estado: "CONFIRMADO_SURTIENDO", estadoPago: "PAGADO" }),
      pedido("3", { estado: "EN_PROCESO", estadoPago: "PENDIENTE" }),
    ]);
    render(<PedidosB2bPage />);
    await screen.findByText("Negocio 1");
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    fireEvent.click(screen.getByRole("button", { name: /^Estado/ }));
    fireEvent.click(await screen.findByRole("option", { name: /^Por confirmar/ }));
    expect(screen.getByText("Estado: Por confirmar", { exact: false })).toBeTruthy();
    expect(screen.queryByText("Negocio 2")).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /^En proceso/ })); // el panel sigue abierto
    expect(screen.getByText("Estado: Por confirmar, En proceso", { exact: false })).toBeTruthy();
    expect(screen.getByText("Negocio 1")).toBeTruthy();
    expect(screen.getByText("Negocio 3")).toBeTruthy();
    expect(screen.queryByText("Negocio 2")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    expect(screen.getByText("Negocio 2")).toBeTruthy(); // sin nada marcado = todos
  });

  it("Estado y Pago se combinan con Y; marcar todas las opciones de Estado equivale a no filtrar", async () => {
    datos([
      pedido("1"),
      pedido("2", { estado: "CONFIRMADO_SURTIENDO", estadoPago: "PAGADO" }),
      pedido("3", { estado: "EN_PROCESO", estadoPago: "PENDIENTE" }),
    ]);
    render(<PedidosB2bPage />);
    await screen.findByText("Negocio 1");
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    fireEvent.click(screen.getByRole("button", { name: /^Estado/ }));
    fireEvent.click(await screen.findByRole("option", { name: /^Por confirmar/ }));
    fireEvent.click(screen.getByRole("option", { name: /^Confirmado/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Pago/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Pagado" }));
    // (Por confirmar O Confirmado) Y Pagado → solo el 2.
    expect(screen.queryByText("Negocio 1")).toBeNull();
    expect(screen.getByText("Negocio 2")).toBeTruthy();
    expect(screen.queryByText("Negocio 3")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtro de Pago" }));
    fireEvent.click(screen.getByRole("button", { name: /^Estado/ }));
    fireEvent.click(await screen.findByRole("option", { name: /^En proceso/ }));
    expect(screen.getByText("Estado: 3 seleccionados", { exact: false })).toBeTruthy();
    expect(screen.getByText("Negocio 1")).toBeTruthy();
    expect(screen.getByText("Negocio 2")).toBeTruthy();
    expect(screen.getByText("Negocio 3")).toBeTruthy();
  });

  it("Exportar Excel con selección múltiple manda exactamente lo marcado (estados y pagos)", async () => {
    Object.assign(window.URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    exportPedidosB2bXlsx.mockResolvedValue(new Blob(["x"]));
    datos([pedido("1"), pedido("2", { estado: "CONFIRMADO_SURTIENDO", estadoPago: "PAGADO" })]);
    render(<PedidosB2bPage />);
    await screen.findByText("Negocio 1");
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    fireEvent.click(screen.getByRole("button", { name: /^Estado/ }));
    fireEvent.click(await screen.findByRole("option", { name: /^Por confirmar/ }));
    fireEvent.click(screen.getByRole("option", { name: /^Confirmado/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Pago/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Pendiente" }));
    fireEvent.click(screen.getByRole("option", { name: "Pagado" }));
    fireEvent.click(screen.getByRole("button", { name: "Exportar Excel" }));
    await waitFor(() => expect(exportPedidosB2bXlsx).toHaveBeenCalledTimes(1));
    const f = exportPedidosB2bXlsx.mock.calls[0][1];
    expect(f.estados).toStrictEqual(["PENDIENTE_CONFIRMACION", "CONFIRMADO_SURTIENDO"]);
    expect(f.estadoPago).toStrictEqual(["PENDIENTE", "PAGADO"]);
    expect(f.cancelado).toBe(false);
  });

  it("Exportar Excel manda los filtros puestos (estado, pago, negocio); sin filtros, los 3 estados activos", async () => {
    Object.assign(window.URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    exportPedidosB2bXlsx.mockResolvedValue(new Blob(["x"]));
    datos([pedido("1", { estado: "CONFIRMADO_SURTIENDO", estadoPago: "PAGADO", negocioNombre: "Negocio A" })]);
    render(<PedidosB2bPage />);
    await screen.findByText("Negocio A");

    fireEvent.click(screen.getByRole("button", { name: "Exportar Excel" }));
    await waitFor(() => expect(exportPedidosB2bXlsx).toHaveBeenCalledTimes(1));
    const sinFiltros = exportPedidosB2bXlsx.mock.calls[0][1];
    expect(sinFiltros.estados).toStrictEqual(["PENDIENTE_CONFIRMACION", "CONFIRMADO_SURTIENDO", "EN_PROCESO"]);
    expect(sinFiltros.estadoPago).toBeUndefined();
    expect(sinFiltros.negocioNombre).toBeUndefined();
    expect(sinFiltros.cancelado).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    fireEvent.click(screen.getByRole("button", { name: /^Negocio/ }));
    fireEvent.change(screen.getByPlaceholderText("Buscar negocio…"), { target: { value: " Negocio A " } });
    fireEvent.click(screen.getByRole("button", { name: "Exportar Excel" }));
    await waitFor(() => expect(exportPedidosB2bXlsx).toHaveBeenCalledTimes(2));
    expect(exportPedidosB2bXlsx.mock.calls[1][1].negocioNombre).toBe("Negocio A");
  });

  it("sin pedidos en la semana: mensaje vacío claro", async () => {
    datos([]);
    render(<PedidosB2bPage />);
    expect(await screen.findByText("No hay pedidos activos para esta semana.")).toBeTruthy();
  });

  it("modal de semanas anteriores: tabla con Semana; clic cierra el modal y abre el panel", async () => {
    datos([pedido("1")], [pedido("9", { semanaInicio: "2026-10-12T00:00:00.000Z" })]);
    render(<PedidosB2bPage />);
    await screen.findByText("Negocio 1");
    fireEvent.click(await screen.findByRole("button", { name: "Ver" }));
    const dialogoFilas = await screen.findByText("Negocio 9");
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toContain("Semana");
    expect(screen.getByText("12 oct 2026")).toBeTruthy();
    fireEvent.click(dialogoFilas);
    await waitFor(() => expect(screen.queryByText("Pedidos de semanas anteriores")).toBeNull());
    expect(await screen.findByText("panel 9")).toBeTruthy();
  });
});
