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

// Ver mis pedidos (4e): lista (activos/anteriores, marca «Modificado por el cliente», «Ver más»), detalle y favorito.

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
const usarPedidoComoFavorito = vi.fn();
vi.mock("@/lib/portal-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portal-api")>();
  return {
    ...actual,
    fetchSesion: (...a: unknown[]) => fetchSesion(...a),
    fetchCalendario: (...a: unknown[]) => fetchCalendario(...a),
    fetchPedidos: (...a: unknown[]) => fetchPedidos(...a),
    fetchPedido: (...a: unknown[]) => fetchPedido(...a),
    usarPedidoComoFavorito: (...a: unknown[]) => usarPedidoComoFavorito(...a),
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
  esFavorito: false,
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
    expect(await screen.findByText("P-000002")).toBeInTheDocument();
    expect(screen.getByText("Por confirmar")).toBeInTheDocument();
    expect(screen.getByText("Completado")).toBeInTheDocument();
    expect(screen.queryByText(/PENDIENTE_CONFIRMACION/)).toBeNull();
    expect(screen.queryByText("Modificado por el cliente")).toBeNull();
    const enlace = screen.getByText("P-000001").closest("a");
    expect(enlace).toHaveAttribute(
      "href",
      "/mayoreo/banetto/portal/pedidos/P-000001",
    );
    expect(
      screen.getByRole("link", { name: /Escribir por WhatsApp/ }),
    ).toBeInTheDocument();
  });

  it("muestra la marca «Modificado por el cliente» cuando el servidor la enciende", async () => {
    fetchPedidos.mockResolvedValue({
      activos: [resumen("P-000003", { modificadoPorCliente: true })],
      anteriores: [],
      siguienteCursor: null,
    });
    render(<ListaPage />);
    expect(
      await screen.findByText("Modificado por el cliente"),
    ).toBeInTheDocument();
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
    expect(await screen.findByText("P-000009")).toBeInTheDocument();
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

  it("entregas con estado (incluida la cancelada), productos, descuento, nota y total", async () => {
    fetchPedido.mockResolvedValue(detalle());
    render(<DetallePage />);
    expect(await screen.findByText(/2 × Concha/)).toBeInTheDocument();
    expect(fetchPedido).toHaveBeenCalledWith("banetto", "P-000001");
    expect(screen.getByText("Pendiente")).toBeInTheDocument();
    expect(screen.getByText("Cancelada")).toBeInTheDocument();
    expect(screen.getByText(/Descuento \(10%\)/)).toBeInTheDocument();
    expect(screen.getByText(/Tocar el timbre/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Usar este pedido como favorito" }),
    ).toBeInTheDocument();
    // Sin acciones de modificar ni cancelar (4f).
    expect(screen.queryByText(/Modificar|Cancelar pedido/i)).toBeNull();
    const wa = screen.getByRole("link", { name: /Escribir por WhatsApp/ });
    expect(decodeURIComponent(wa.getAttribute("href") ?? "")).toContain(
      "sobre mi pedido P-000001",
    );
  });

  it("folio inexistente o ajeno → «No encontramos este pedido»", async () => {
    fetchPedido.mockRejectedValue(new PortalError("Pedido no encontrado", 404));
    render(<DetallePage />);
    expect(
      await screen.findByText("No encontramos este pedido."),
    ).toBeInTheDocument();
  });

  it("usar como favorito: confirma el reemplazo, guarda y pasa a «Es tu pedido favorito»", async () => {
    fetchPedido.mockResolvedValue(detalle());
    usarPedidoComoFavorito.mockResolvedValue({ favorito: null, omitidos: [] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DetallePage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Usar este pedido como favorito",
      }),
    );
    expect(
      await screen.findByText(/Es tu pedido favorito/),
    ).toBeInTheDocument();
    expect(usarPedidoComoFavorito).toHaveBeenCalledWith("banetto", "P-000001");
  });

  it("si el cliente no confirma el reemplazo no se guarda nada", async () => {
    fetchPedido.mockResolvedValue(detalle());
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<DetallePage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Usar este pedido como favorito",
      }),
    );
    expect(usarPedidoComoFavorito).not.toHaveBeenCalled();
  });
});
