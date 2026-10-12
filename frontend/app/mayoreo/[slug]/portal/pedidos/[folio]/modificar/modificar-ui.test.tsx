import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { EstadoModificarPortal } from "@/lib/portal-api";

// Modificar pedido (4f): días editables y bloqueados, qué se manda al guardar, errores del servidor.

const replace = vi.fn();
const router = { replace, push: vi.fn() };
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "banetto", folio: "P-000001" }),
  usePathname: () => "/mayoreo/banetto/portal/pedidos/P-000001/modificar",
  useRouter: () => router,
}));

const fetchSesion = vi.fn();
const fetchCalendario = vi.fn();
const fetchEstadoModificar = vi.fn();
const fetchCatalogo = vi.fn();
const modificarPedido = vi.fn();
vi.mock("@/lib/portal-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portal-api")>();
  return {
    ...actual,
    fetchSesion: (...a: unknown[]) => fetchSesion(...a),
    fetchCalendario: (...a: unknown[]) => fetchCalendario(...a),
    fetchEstadoModificar: (...a: unknown[]) => fetchEstadoModificar(...a),
    fetchCatalogo: (...a: unknown[]) => fetchCatalogo(...a),
    modificarPedido: (...a: unknown[]) => modificarPedido(...a),
  };
});

const { default: Page } = await import("./page");
const { PortalError } = await import("@/lib/portal-api");

const SESION = {
  negocio: { nombre: "Banetto" },
  telefonoTerminacion: "6915",
  cliente: { id: "c1", nombre: "Cafe Entredos" },
  clientes: [{ id: "c1", nombre: "Cafe Entredos" }],
  requiereSeleccion: false,
};

const estado = (
  extra: Partial<EstadoModificarPortal> = {},
): EstadoModificarPortal => ({
  folio: "P-000001",
  version: "2026-09-30T16:00:00.000Z",
  semanaInicio: "2026-09-28",
  semanaFin: "2026-10-04",
  estadoPedido: "CONFIRMADO_SURTIENDO",
  pagado: false,
  modificadoPorCliente: false,
  bloqueo: null,
  horasAgregar: 36,
  horasModificar: 18,
  descuentoPorcentaje: 0,
  minimoPiezas: 0,
  notaCliente: null,
  numeroAtencion: "5512345678",
  dias: [
    {
      fecha: "2026-10-01",
      diaSemana: "JUEVES",
      estado: "CERRADO",
      motivo: "ANTICIPACION_MODIFICAR",
      limiteAt: null,
      entrega: {
        estado: "PENDIENTE",
        productos: [
          {
            productId: "A",
            nombre: "Café americano",
            cantidad: 1,
            precioUnitario: 45,
          },
        ],
      },
    },
    {
      fecha: "2026-10-02",
      diaSemana: "VIERNES",
      estado: "MODIFICABLE",
      motivo: null,
      limiteAt: "2026-10-01T20:00:00.000Z",
      entrega: {
        estado: "PENDIENTE",
        productos: [
          {
            productId: "A",
            nombre: "Café americano",
            cantidad: 2,
            precioUnitario: 45,
          },
        ],
      },
    },
    {
      fecha: "2026-10-03",
      diaSemana: "SABADO",
      estado: "MODIFICABLE",
      motivo: null,
      limiteAt: "2026-10-02T20:00:00.000Z",
      entrega: {
        estado: "PENDIENTE",
        productos: [
          {
            productId: "A",
            nombre: "Café americano",
            cantidad: 3,
            precioUnitario: 45,
          },
        ],
      },
    },
    {
      fecha: "2026-10-04",
      diaSemana: "DOMINGO",
      estado: "AGREGABLE",
      motivo: null,
      limiteAt: "2026-10-03T02:00:00.000Z",
      entrega: null,
    },
  ],
  ...extra,
});

beforeEach(() => {
  fetchSesion.mockResolvedValue(SESION);
  fetchCalendario.mockResolvedValue({ numeroAtencion: "5512345678" });
  fetchCatalogo.mockResolvedValue({
    categories: [
      {
        id: "c",
        nombre: "Bebidas",
        products: [
          { id: "A", nombre: "Café americano", precio: 45 },
          { id: "B", nombre: "Concha", precio: 30.5 },
        ],
      },
    ],
  });
  fetchEstadoModificar.mockResolvedValue(estado());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("modificar pedido", () => {
  it("muestra editables los días permitidos y de solo lectura (con WhatsApp) el cerrado", async () => {
    render(<Page />);
    expect(
      await screen.findByLabelText(/Café americano el .*2 de oct/i),
    ).toBeInTheDocument();
    // El día cerrado no tiene input, pero sí el botón de contacto.
    expect(screen.queryByLabelText(/Café americano el .*1 de oct/i)).toBeNull();
    expect(
      screen.getAllByRole("link", { name: /Escribir por WhatsApp/ }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/volverá a Por confirmar hasta que lo confirmemos/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/incluidos los de entregas ya cerradas/),
    ).toBeInTheDocument();
  });

  it("sin cambios el botón de guardar está deshabilitado; con cambios manda solo la fecha que cambió", async () => {
    modificarPedido.mockResolvedValue({
      cambio: true,
      pedido: { estado: { codigo: "PENDIENTE_CONFIRMACION" } },
    });
    render(<Page />);
    const guardar = await screen.findByRole("button", {
      name: "Guardar cambios",
    });
    expect(guardar).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Café americano el .*3 de oct/i), {
      target: { value: "5" },
    });
    expect(guardar).toBeEnabled();
    fireEvent.click(guardar);
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmar y guardar" }),
    );
    await waitFor(() => expect(modificarPedido).toHaveBeenCalled());
    expect(modificarPedido).toHaveBeenCalledWith("banetto", "P-000001", {
      version: "2026-09-30T16:00:00.000Z",
      entregas: [
        { fecha: "2026-10-03", items: [{ productId: "A", cantidad: 5 }] },
      ],
    });
    expect(await screen.findByText("Cambios guardados")).toBeInTheDocument();
  });

  it("quitar una entrega manda items vacío; quitar todas bloquea el guardado", async () => {
    modificarPedido.mockResolvedValue({
      cambio: true,
      pedido: { estado: { codigo: "PENDIENTE_CONFIRMACION" } },
    });
    render(<Page />);
    await screen.findByRole("button", { name: "Guardar cambios" });
    const quitar = screen.getAllByRole("button", {
      name: "Quitar esta entrega",
    });
    fireEvent.click(quitar[0]);
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmar y guardar" }),
    );
    await waitFor(() => expect(modificarPedido).toHaveBeenCalled());
    expect(modificarPedido.mock.calls[0][2].entregas).toEqual([
      { fecha: "2026-10-02", items: [] },
    ]);
  });

  it("al quitar todas las entregas editables y no quedar ninguna, avisa y deshabilita guardar", async () => {
    fetchEstadoModificar.mockResolvedValue(
      estado({
        dias: estado().dias.filter((d) => d.fecha !== "2026-10-01"),
      }),
    );
    render(<Page />);
    await screen.findByRole("button", { name: "Guardar cambios" });
    for (const b of screen.getAllByRole("button", {
      name: "Quitar esta entrega",
    }))
      fireEvent.click(b);
    expect(
      screen.getByText(/debe conservar al menos una entrega/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }),
    ).toBeDisabled();
  });

  it("pedido pagado: sin edición y con el mensaje y el botón de contacto", async () => {
    fetchEstadoModificar.mockResolvedValue(
      estado({
        bloqueo: {
          codigo: "PEDIDO_PAGADO",
          mensaje:
            "Este pedido ya está pagado y no se puede modificar desde el portal. Contáctanos",
        },
      }),
    );
    render(<Page />);
    expect(await screen.findByText(/ya está pagado/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Guardar cambios" }),
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: /Escribir por WhatsApp/ }),
    ).toBeInTheDocument();
  });

  it("si el servidor rechaza (409), muestra el motivo y vuelve a leer el pedido", async () => {
    modificarPedido.mockRejectedValue(
      new PortalError("El 2 de octubre ya no se puede modificar", 409, {
        codigo: "FECHAS_NO_DISPONIBLES",
        fechas: [
          {
            fecha: "2026-10-02",
            motivo: "ANTICIPACION_MODIFICAR",
            mensaje: "El viernes 2 de octubre ya no se puede modificar",
          },
        ],
      }),
    );
    render(<Page />);
    fireEvent.change(
      await screen.findByLabelText(/Café americano el .*3 de oct/i),
      {
        target: { value: "5" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmar y guardar" }),
    );
    expect(
      await screen.findAllByText(/ya no se puede modificar/),
    ).not.toHaveLength(0);
    await waitFor(() => expect(fetchEstadoModificar).toHaveBeenCalledTimes(2));
  });
});
