import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  DetallePedidoPortal,
  ListaPedidosPortal,
  ResumenPedidoPortal,
} from "@/lib/portal-api";

// Ver mis pedidos (4e): lista (activos/anteriores, marca «Modificado por el cliente», «Ver más»), y detalle.

const replace = vi.fn();
// El router real de Next es estable entre renders; el mock también.
const router = { replace, push: vi.fn() };
let params: Record<string, string> = { slug: "banetto" };
vi.mock("next/navigation", () => ({
  useParams: () => params,
  usePathname: () => "/mayoreo/banetto/portal/pedidos",
  useRouter: () => router,
}));

const fetchSesion = vi.fn();
const fetchCalendario = vi.fn();
const fetchPedidos = vi.fn();
const fetchPedido = vi.fn();
vi.mock("@/lib/portal-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portal-api")>();
  return {
    ...actual,
    fetchSesion: (...a: unknown[]) => fetchSesion(...a),
    fetchCalendario: (...a: unknown[]) => fetchCalendario(...a),
    fetchPedidos: (...a: unknown[]) => fetchPedidos(...a),
    fetchPedido: (...a: unknown[]) => fetchPedido(...a),
  };
});

const { default: ListaPage } = await import("./page");
const { default: DetallePage } = await import("./[folio]/page");
const { PortalError } = await import("@/lib/portal-api");

const SESION = {
  negocio: { nombre: "Banetto" },
  telefonoTerminacion: "6915",
  cliente: { id: "c1", nombre: "Cafe Entredos" },
  clientes: [{ id: "c1", nombre: "Cafe Entredos" }],
  requiereSeleccion: false,
};

const resumen = (
  folio: string,
  extra: Partial<ResumenPedidoPortal> = {},
): ResumenPedidoPortal => ({
  folio,
  semanaInicio: "2026-09-28",
  semanaFin: "2026-10-04",
  estado: { codigo: "PENDIENTE_CONFIRMACION", etiqueta: "Por confirmar" },
  pago: { estado: "PENDIENTE", etiqueta: "Pago pendiente", pagadoAt: null },
  modificadoPorCliente: false,
  totalPiezas: 6,
  total: 255.5,
  fechasEntrega: ["2026-09-28", "2026-09-30"],
  ...extra,
});

const detalle = (
  extra: Partial<DetallePedidoPortal> = {},
): DetallePedidoPortal => ({
  ...resumen("P-000001"),
  subtotal: 255.5,
  descuentoPorcentaje: 10,
  descuentoTotal: 25.55,
  total: 229.95,
  notaCliente: "Tocar el timbre",
  version: "2026-09-30T16:00:00.000Z",
  modificable: false,
  entregas: [
    {
      fecha: "2026-10-02",
      estado: { codigo: "PENDIENTE", etiqueta: "Pendiente" },
      productos: [
        { nombre: "Concha", cantidad: 2, precioUnitario: 30.5, subtotal: 61 },
      ],
    },
    {
      fecha: "2026-10-03",
      estado: { codigo: "CANCELADA", etiqueta: "Cancelada" },
      productos: [
        {
          nombre: "Café americano",
          cantidad: 1,
          precioUnitario: 45,
          subtotal: 45,
        },
      ],
    },
  ],
  ...extra,
});

beforeEach(() => {
  params = { slug: "banetto" };
  fetchSesion.mockResolvedValue(SESION);
  fetchCalendario.mockResolvedValue({ numeroAtencion: "5512345678" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("lista de pedidos", () => {
  it("separa activos y anteriores, con estado en español y enlace al detalle con el folio", async () => {
    const lista: ListaPedidosPortal = {
      activos: [resumen("P-000002")],
      anteriores: [
        resumen("P-000001", {
          estado: { codigo: "COMPLETADO", etiqueta: "Completado" },
          pago: { estado: "PAGADO", etiqueta: "Pagado", pagadoAt: null },
        }),
      ],
      siguienteCursor: null,
    };
    fetchPedidos.mockResolvedValue(lista);
    render(<ListaPage />);
    expect(await screen.findByText("Por confirmar")).toBeInTheDocument();
    // La tarjeta no muestra folio: semana, días con recolección y piezas.
    expect(screen.queryByText("P-000002")).toBeNull();
    expect(screen.getAllByText("Semana 28 sep – 4 oct")).toHaveLength(2);
    expect(screen.getAllByText("Lun 28 · Mié 30 · 6 pzas")).toHaveLength(2);
    expect(screen.getByText("Completado")).toBeInTheDocument();
    expect(screen.queryByText(/PENDIENTE_CONFIRMACION/)).toBeNull();
    expect(screen.queryByText("Modificado por el cliente")).toBeNull();
    expect(
      screen
        .getAllByRole("link")
        .some(
          (a) =>
            a.getAttribute("href") ===
            "/mayoreo/banetto/portal/pedidos/P-000001",
        ),
    ).toBe(true);
    expect(
      screen.getByRole("link", { name: /Escribir por WhatsApp/ }),
    ).toBeInTheDocument();
  });

  it("la tarjeta de la lista no muestra la marca «Modificado por el cliente» (es para el negocio)", async () => {
    fetchPedidos.mockResolvedValue({
      activos: [resumen("P-000003", { modificadoPorCliente: true })],
      anteriores: [],
      siguienteCursor: null,
    });
    render(<ListaPage />);
    expect(await screen.findByText("Por confirmar")).toBeInTheDocument();
    expect(screen.queryByText("Modificado por el cliente")).toBeNull();
  });

  it("activos: la semana más próxima primero", async () => {
    fetchPedidos.mockResolvedValue({
      activos: [
        resumen("P-000005", {
          semanaInicio: "2026-10-12",
          semanaFin: "2026-10-18",
        }),
        resumen("P-000004"),
      ],
      anteriores: [],
      siguienteCursor: null,
    });
    render(<ListaPage />);
    await screen.findAllByText(/^Semana /);
    const semanas = screen.getAllByText(/^Semana /).map((e) => e.textContent);
    expect(semanas).toEqual(["Semana 28 sep – 4 oct", "Semana 12–18 oct"]);
  });

  it("sin pedidos: mensajes vacíos; «Ver más» pide la siguiente página", async () => {
    fetchPedidos.mockResolvedValueOnce({
      activos: [],
      anteriores: [resumen("P-000010")],
      siguienteCursor: "20",
    });
    fetchPedidos.mockResolvedValueOnce({
      activos: [],
      anteriores: [resumen("P-000009")],
      siguienteCursor: null,
    });
    render(<ListaPage />);
    expect(
      await screen.findByText("No tienes pedidos activos."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver más" }));
    await waitFor(() =>
      expect(screen.getAllByText("Semana 28 sep – 4 oct")).toHaveLength(2),
    );
    expect(fetchPedidos).toHaveBeenLastCalledWith("banetto", "20");
    expect(screen.queryByRole("button", { name: "Ver más" })).toBeNull();
  });

  it("sin sesión vuelve a la raíz del portal", async () => {
    fetchSesion.mockRejectedValue(new PortalError("Tu sesión terminó", 401));
    render(<ListaPage />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/mayoreo/banetto"),
    );
  });
});

describe("detalle del pedido", () => {
  beforeEach(() => {
    params = { slug: "banetto", folio: "P-000001" };
  });

  it("no muestra el pago ni la marca «Modificado por el cliente»", async () => {
    fetchPedido.mockResolvedValue(
      detalle({
        modificadoPorCliente: true,
        pago: {
          estado: "PAGADO",
          etiqueta: "Pagado",
          pagadoAt: "2026-10-02T18:00:00.000Z",
        },
      }),
    );
    render(<DetallePage />);
    expect(await screen.findByText("Concha")).toBeInTheDocument();
    expect(screen.queryByText(/Pagado|Pago pendiente/)).toBeNull();
    expect(screen.queryByText(/Modificado por el cliente/)).toBeNull();
  });

  it("entregas con estado (incluida la cancelada), productos, descuento, nota y total", async () => {
    fetchPedido.mockResolvedValue(detalle());
    render(<DetallePage />);
    // Solo cantidades: nombre y cantidad por separado, sin «×» ni precios.
    expect(await screen.findByText("Concha")).toBeInTheDocument();
    expect(screen.queryByText(/×/)).toBeNull();
    expect(screen.queryByText(/c\/u/)).toBeNull();
    expect(fetchPedido).toHaveBeenCalledWith("banetto", "P-000001");
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(screen.getByText(/10% de descuento/)).toBeInTheDocument();
    expect(screen.getByText(/Tocar el timbre/)).toBeInTheDocument();
    // El favorito ya no se maneja desde el detalle de un pedido.
    expect(screen.queryByText(/favorito/i)).toBeNull();
    // Sin acciones de modificar ni cancelar (4f).
    expect(screen.queryByText(/Modificar|Cancelar pedido/i)).toBeNull();
    const wa = screen.getByRole("link", { name: /Escribir por WhatsApp/ });
    expect(decodeURIComponent(wa.getAttribute("href") ?? "")).toContain(
      "sobre mi pedido P-000001",
    );
  });

  it("pedido modificable: «Modificar pedido» en la barra fija, hacia la pantalla de modificar con origen «detalle»", async () => {
    fetchPedido.mockResolvedValue(detalle({ modificable: true }));
    render(<DetallePage />);
    const enlace = await screen.findByRole("link", {
      name: "Modificar pedido",
    });
    expect(enlace.getAttribute("href")).toBe(
      "/mayoreo/banetto/portal/pedidos/P-000001/modificar?desde=detalle",
    );
  });

  it("folio inexistente o ajeno → «No encontramos este pedido»", async () => {
    fetchPedido.mockRejectedValue(new PortalError("Pedido no encontrado", 404));
    render(<DetallePage />);
    expect(
      await screen.findByText("No encontramos este pedido."),
    ).toBeInTheDocument();
  });
});
