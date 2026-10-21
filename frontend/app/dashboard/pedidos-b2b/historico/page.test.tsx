import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { PaginatedPedidosB2b, PedidoB2bReportable } from "@/lib/api";

vi.mock("@/lib/session-context", () => ({ useSession: () => ({ user: { rol: "GERENTE" }, token: "t" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard/pedidos-b2b/historico" }));
vi.mock("../detalle-panel", () => ({ default: ({ pedidoId }: { pedidoId: string | null }) => (pedidoId ? <div>panel {pedidoId}</div> : null) }));

const fetchPedidosB2b = vi.fn();
const exportPedidosB2bXlsx = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchPedidosB2b, exportPedidosB2bXlsx };
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
  beforeEach(() => {
    fetchPedidosB2b.mockReset();
    exportPedidosB2bXlsx.mockReset();
  });
  afterEach(cleanup);

  it("al abrir carga el histórico solo (sin pulsar Buscar), con TODOS los pedidos: sin soloHistorico ni filtros de estado", async () => {
    fetchPedidosB2b.mockResolvedValue(respuesta([fila("1"), fila("2", { cancelado: true, estadoPago: "PENDIENTE", total: "0" })]));
    render(<Historico />);
    await screen.findByText("Negocio 1");
    expect(fetchPedidosB2b).toHaveBeenCalledTimes(1);
    expect(fetchPedidosB2b.mock.calls[0][1]).toMatchObject({ page: 1, limit: 25 });
    // Históricos incluye los pedidos activos: ya no pide solo Completados y Cancelados.
    expect(fetchPedidosB2b.mock.calls[0][1].soloHistorico).toBeUndefined();
    expect(fetchPedidosB2b.mock.calls[0][1].estado).toBeUndefined();
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

  it("Pago es de selección múltiple: marcar no cierra el panel; con una opción se ve «Pago: Pagado ✕»", async () => {
    fetchPedidosB2b.mockResolvedValueOnce(respuesta([fila("1"), fila("2")]));
    render(<Historico />);
    await screen.findByText("Negocio 1");
    fetchPedidosB2b.mockResolvedValueOnce(respuesta([fila("2")]));
    await abrirFiltro("Pago");
    // Se abre directo la lista de opciones (sin select intermedio ni botón «Aplicar»); marcar aplica al instante y NO cierra la lista.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
    fireEvent.click(await screen.findByRole("option", { name: "Pagado" }));
    await waitFor(() => expect(fetchPedidosB2b).toHaveBeenCalledTimes(2));
    expect(fetchPedidosB2b.mock.calls[1][1]).toMatchObject({ estadoPago: ["PAGADO"], page: 1 });
    expect(fetchPedidosB2b.mock.calls[1][1].soloHistorico).toBeUndefined();
    await screen.findByText("1–1 de 1 resultado");
    expect(screen.getByRole("option", { name: "Pendiente" })).toBeTruthy(); // el panel sigue abierto
    expect(screen.getByRole("option", { name: "Pagado" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Pago: Pagado", { exact: false })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Quitar filtro de Pago" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Limpiar filtros" })).toBeTruthy();
  });

  it("Pago con las dos opciones: se muestran ambos nombres, la consulta no filtra por pago (marcar todo = todos) y «Limpiar» vacía el filtro", async () => {
    fetchPedidosB2b.mockResolvedValue(respuesta([fila("1")]));
    render(<Historico />);
    await screen.findByText("Negocio 1");
    await abrirFiltro("Pago");
    fireEvent.click(await screen.findByRole("option", { name: "Pendiente" }));
    await waitFor(() => expect(fetchPedidosB2b.mock.calls.at(-1)![1].estadoPago).toStrictEqual(["PENDIENTE"]));
    fireEvent.click(screen.getByRole("option", { name: "Pagado" }));
    await waitFor(() => expect(screen.getByText("Pago: Pendiente, Pagado", { exact: false })).toBeTruthy());
    await waitFor(() => expect(fetchPedidosB2b.mock.calls.at(-1)![1].estadoPago).toBeUndefined());
    expect(screen.getByRole("option", { name: "Pendiente" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    await waitFor(() => expect(screen.queryByText("Pago:", { exact: false })).toBeNull());
  });

  it("Estado: ofrece los cinco estados; con 1 opción «Estado: Por confirmar», con 2 ambos nombres y con 3 «3 seleccionados»", async () => {
    fetchPedidosB2b.mockResolvedValue(respuesta([fila("1")]));
    render(<Historico />);
    await screen.findByText("Negocio 1");
    await abrirFiltro("Estado");
    const opciones = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(opciones).toStrictEqual(["Por confirmar", "Confirmado", "En proceso", "Completado", "Cancelado"]);
    fireEvent.click(screen.getByRole("option", { name: /^Por confirmar/ }));
    await waitFor(() => expect(screen.getByText("Estado: Por confirmar", { exact: false })).toBeTruthy());
    fireEvent.click(screen.getByRole("option", { name: /^Confirmado/ }));
    await waitFor(() => expect(screen.getByText("Estado: Por confirmar, Confirmado", { exact: false })).toBeTruthy());
    fireEvent.click(screen.getByRole("option", { name: /^En proceso/ }));
    await waitFor(() => expect(screen.getByText("Estado: 3 seleccionados", { exact: false })).toBeTruthy());
    // Dos estados (O) y ninguno es Cancelado: se piden esos estados y solo los no cancelados.
    expect(fetchPedidosB2b.mock.calls.at(-1)![1]).toMatchObject({
      estados: ["PENDIENTE_CONFIRMACION", "CONFIRMADO_SURTIENDO", "EN_PROCESO"],
      cancelado: false,
    });
    expect(fetchPedidosB2b.mock.calls.at(-1)![1].conCancelados).toBeUndefined();
    expect(fetchPedidosB2b.mock.calls.at(-1)![1].soloHistorico).toBeUndefined();
  });

  it("«Completado» + «Cancelado»: pide los Completados no cancelados MÁS los cancelados de cualquier estado (conCancelados)", async () => {
    fetchPedidosB2b.mockResolvedValue(respuesta([fila("1")]));
    render(<Historico />);
    await screen.findByText("Negocio 1");
    await abrirFiltro("Estado");
    fireEvent.click(await screen.findByRole("option", { name: /^Completado/ }));
    fireEvent.click(screen.getByRole("option", { name: /^Cancelado/ }));
    await waitFor(() => expect(fetchPedidosB2b.mock.calls.at(-1)![1].conCancelados).toBe(true));
    const f = fetchPedidosB2b.mock.calls.at(-1)![1];
    expect(f.estados).toStrictEqual(["COMPLETADO"]);
    expect(f.cancelado).toBeUndefined();
  });

  it("solo «Cancelado»: cancelado=true sin estados; solo «Completado»: cancelado=false (como siempre)", async () => {
    fetchPedidosB2b.mockResolvedValue(respuesta([fila("1")]));
    render(<Historico />);
    await screen.findByText("Negocio 1");
    await abrirFiltro("Estado");
    fireEvent.click(await screen.findByRole("option", { name: /^Cancelado/ }));
    await waitFor(() => expect(fetchPedidosB2b.mock.calls.at(-1)![1].cancelado).toBe(true));
    expect(fetchPedidosB2b.mock.calls.at(-1)![1].estados).toBeUndefined();
    expect(fetchPedidosB2b.mock.calls.at(-1)![1].conCancelados).toBeUndefined();
    fireEvent.click(screen.getByRole("option", { name: /^Cancelado/ })); // desmarca
    fireEvent.click(screen.getByRole("option", { name: /^Completado/ }));
    await waitFor(() => expect(fetchPedidosB2b.mock.calls.at(-1)![1].estados).toStrictEqual(["COMPLETADO"]));
    expect(fetchPedidosB2b.mock.calls.at(-1)![1].cancelado).toBe(false);
  });

  it("marcar los cinco estados = no filtrar por estado (el control conserva lo marcado)", async () => {
    fetchPedidosB2b.mockResolvedValue(respuesta([fila("1")]));
    render(<Historico />);
    await screen.findByText("Negocio 1");
    await abrirFiltro("Estado");
    for (const nombre of [/^Por confirmar/, /^Confirmado/, /^En proceso/, /^Completado/, /^Cancelado/]) {
      fireEvent.click(await screen.findByRole("option", { name: nombre }));
    }
    await waitFor(() => expect(screen.getByText("Estado: 5 seleccionados", { exact: false })).toBeTruthy());
    const f = fetchPedidosB2b.mock.calls.at(-1)![1];
    expect(f.estados).toBeUndefined();
    expect(f.cancelado).toBeUndefined();
    expect(f.conCancelados).toBeUndefined();
    expect(screen.getByRole("option", { name: /^Cancelado/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("Estado y Pago se combinan con Y, y el Excel manda exactamente la misma selección", async () => {
    Object.assign(window.URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    exportPedidosB2bXlsx.mockResolvedValue(new Blob(["x"]));
    fetchPedidosB2b.mockResolvedValue(respuesta([fila("1")]));
    render(<Historico />);
    await screen.findByText("Negocio 1");
    await abrirFiltro("Estado");
    fireEvent.click(await screen.findByRole("option", { name: /^En proceso/ }));
    fireEvent.click(screen.getByRole("option", { name: /^Cancelado/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Pago/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Pendiente" }));
    await waitFor(() => expect(fetchPedidosB2b.mock.calls.at(-1)![1].estadoPago).toStrictEqual(["PENDIENTE"]));
    const lista = fetchPedidosB2b.mock.calls.at(-1)![1];
    expect(lista).toMatchObject({ estados: ["EN_PROCESO"], conCancelados: true, estadoPago: ["PENDIENTE"] });
    fireEvent.click(screen.getByRole("button", { name: "Exportar Excel" }));
    await waitFor(() => expect(exportPedidosB2bXlsx).toHaveBeenCalledTimes(1));
    const excel = exportPedidosB2bXlsx.mock.calls[0][1];
    expect(excel).toMatchObject({ vista: "HISTORICOS", estados: ["EN_PROCESO"], conCancelados: true, estadoPago: ["PENDIENTE"] });
    expect(excel.cancelado).toBeUndefined();
  });

  it("un pedido activo (Por confirmar) aparece en la lista con su estado y abre el mismo panel", async () => {
    fetchPedidosB2b.mockResolvedValue(respuesta([fila("5", { estado: "PENDIENTE_CONFIRMACION", estadoPago: "PENDIENTE", semanaInicio: "2026-10-26T00:00:00.000Z" })]));
    render(<Historico />);
    expect(await screen.findByText("Por confirmar")).toBeTruthy();
    fireEvent.click(screen.getByText("Negocio 5"));
    expect(await screen.findByText("panel 5")).toBeTruthy();
  });

  it("Exportar Excel manda los filtros puestos y la vista HISTORICOS (sin soloHistorico)", async () => {
    Object.assign(window.URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    exportPedidosB2bXlsx.mockResolvedValue(new Blob(["x"]));
    fetchPedidosB2b.mockResolvedValue(respuesta([fila("1")]));
    render(<Historico />);
    await screen.findByText("Negocio 1");
    fireEvent.change(screen.getByPlaceholderText("Buscar negocio…"), { target: { value: "aurora" } });
    await waitFor(() => expect(fetchPedidosB2b.mock.calls.at(-1)![1].negocioNombre).toBe("aurora"));
    fireEvent.click(screen.getByRole("button", { name: "Exportar Excel" }));
    await waitFor(() => expect(exportPedidosB2bXlsx).toHaveBeenCalledTimes(1));
    const filtro = exportPedidosB2bXlsx.mock.calls[0][1];
    expect(filtro).toMatchObject({ vista: "HISTORICOS", negocioNombre: "aurora" });
    expect(filtro.soloHistorico).toBeUndefined();
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
