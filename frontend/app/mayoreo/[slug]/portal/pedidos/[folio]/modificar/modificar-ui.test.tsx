import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { EstadoModificarPortal } from "@/lib/portal-api";

// Modificar pedido (4f): días editables y bloqueados, qué se manda al guardar, errores del servidor.

let searchActual = "";
const replace = vi.fn();
const router = { replace, push: vi.fn() };
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "banetto", folio: "P-000001" }),
  usePathname: () => "/mayoreo/banetto/portal/pedidos/P-000001/modificar",
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(searchActual),
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
  searchActual = "";
  cleanup();
  vi.clearAllMocks();
});

describe("modificar pedido", () => {
  it("muestra editables los días permitidos y de solo lectura (sin botón) el cerrado", async () => {
    render(<Page />);
    expect(
      await screen.findByLabelText(/Café americano el .*2 oct/i),
    ).toBeInTheDocument();
    // El día cerrado no tiene input ni botón de contacto.
    expect(screen.queryByLabelText(/Café americano el .*1 oct/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /Escribir por WhatsApp/ })).toBeNull();
    // Encabezado: semana corta y folio; ya no hay recuadro con el texto de reglas.
    expect(screen.getByText("Semana 28 sep – 4 oct")).toBeInTheDocument();
    expect(screen.queryByText("Pedido P-000001")).toBeNull();
    expect(screen.queryByText(/Puedes cambiar un día hasta/)).toBeNull();
    expect(screen.queryByText(/Cambia antes del/)).toBeNull();
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

    fireEvent.change(screen.getByLabelText(/Café americano el .*3 oct/i), {
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

  it("quitar una entrega pide confirmación y manda items vacío; hasta confirmar no cambia nada", async () => {
    modificarPedido.mockResolvedValue({
      cambio: true,
      pedido: { estado: { codigo: "PENDIENTE_CONFIRMACION" } },
    });
    render(<Page />);
    await screen.findByRole("button", { name: "Guardar cambios" });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Quitar este día" })[0],
    );
    // La ventana aparece y todavía no hay cambios que guardar.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Quitar" }));
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
    // Cada entrega se quita con su confirmación.
    for (let i = 0; i < 2; i += 1) {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Quitar este día" })[0],
      );
      fireEvent.click(screen.getByRole("button", { name: "Quitar" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    }
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
      new PortalError("El 2 octubre ya no se puede modificar", 409, {
        codigo: "FECHAS_NO_DISPONIBLES",
        fechas: [
          {
            fecha: "2026-10-02",
            motivo: "ANTICIPACION_MODIFICAR",
            mensaje: "El viernes 2 octubre ya no se puede modificar",
          },
        ],
      }),
    );
    render(<Page />);
    fireEvent.change(
      await screen.findByLabelText(/Café americano el .*3 oct/i),
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

  // ---- Ajustes de interfaz (4f) ----

  it("bote de basura: quita el producto de la entrega y manda ese cambio; escribir 0 sigue funcionando", async () => {
    modificarPedido.mockResolvedValue({
      cambio: true,
      pedido: { estado: { codigo: "PENDIENTE_CONFIRMACION" } },
    });
    render(<Page />);
    await screen.findByRole("button", { name: "Guardar cambios" });
    const basura = screen.getByRole("button", {
      name: /Quitar Café americano del Vie 2 oct/,
    });
    // Tamaño cómodo para el dedo (44 px).
    expect(basura.className).toMatch(/h-11/);
    expect(basura.className).toMatch(/w-11/);
    fireEvent.click(basura);
    // La fila desaparece (ya no hay cantidad para ese día)…
    expect(screen.queryByLabelText(/Café americano el Vie 2 oct/)).toBeNull();
    // …y escribir 0 en otro día sigue siendo válido.
    fireEvent.change(screen.getByLabelText(/Café americano el Sáb 3 oct/), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmar y guardar" }),
    );
    await waitFor(() => expect(modificarPedido).toHaveBeenCalled());
    expect(modificarPedido.mock.calls[0][2].entregas).toEqual([
      { fecha: "2026-10-02", items: [] },
      { fecha: "2026-10-03", items: [] },
    ]);
  });

  it("agregar producto: pregunta «¿Cuántos para …?», con el campo enfocado; Cancelar no agrega nada", async () => {
    render(<Page />);
    await screen.findByRole("button", { name: "Guardar cambios" });
    fireEvent.change(screen.getByLabelText(/Agregar producto el Vie 2 oct/), {
      target: { value: "B" },
    });
    const ventana = await screen.findByRole("dialog");
    expect(
      within(ventana).getByText("¿Cuántos para Vie 2 oct?"),
    ).toBeInTheDocument();
    const campo = within(ventana).getByLabelText("Cantidad");
    expect(campo).toHaveFocus();
    fireEvent.change(campo, { target: { value: "4" } });
    fireEvent.click(within(ventana).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Nada se agregó: sigue sin haber cambios y la Concha no está en el día.
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }),
    ).toBeDisabled();
    expect(screen.queryByLabelText(/Concha el Vie 2 oct/)).toBeNull();
  });

  it("agregar producto: Agregar lo incluye con la cantidad escrita y se manda al guardar; sin cantidad no deja", async () => {
    modificarPedido.mockResolvedValue({
      cambio: true,
      pedido: { estado: { codigo: "PENDIENTE_CONFIRMACION" } },
    });
    render(<Page />);
    await screen.findByRole("button", { name: "Guardar cambios" });
    fireEvent.change(screen.getByLabelText(/Agregar producto el Vie 2 oct/), {
      target: { value: "B" },
    });
    const ventana = await screen.findByRole("dialog");
    // Sin cantidad el botón está deshabilitado.
    expect(
      within(ventana).getByRole("button", { name: "Agregar" }),
    ).toBeDisabled();
    fireEvent.change(within(ventana).getByLabelText("Cantidad"), {
      target: { value: "4" },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: "Agregar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      (screen.getByLabelText(/Concha el Vie 2 oct/) as HTMLInputElement).value,
    ).toBe("4");

    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirmar y guardar" }),
    );
    await waitFor(() => expect(modificarPedido).toHaveBeenCalled());
    expect(modificarPedido.mock.calls[0][2].entregas).toEqual([
      {
        fecha: "2026-10-02",
        items: [
          { productId: "A", cantidad: 2 },
          { productId: "B", cantidad: 4 },
        ],
      },
    ]);
  });

  it("quitar entrega: confirmación con el número de productos y piezas; Cancelar no quita nada", async () => {
    fetchEstadoModificar.mockResolvedValue(
      estado({
        dias: estado().dias.map((d) =>
          d.fecha === "2026-10-02" && d.entrega
            ? {
                ...d,
                entrega: {
                  ...d.entrega,
                  productos: [
                    ...d.entrega.productos,
                    {
                      productId: "B",
                      nombre: "Concha",
                      cantidad: 3,
                      precioUnitario: 30.5,
                    },
                  ],
                },
              }
            : d,
        ),
      }),
    );
    render(<Page />);
    await screen.findByRole("button", { name: "Guardar cambios" });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Quitar este día" })[0],
    );
    const ventana = await screen.findByRole("dialog");
    expect(
      within(ventana).getByText("¿Quitar la entrega del Vie 2 oct?"),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText(/Se quitarán 2 productos \(5 piezas\)/),
    ).toBeInTheDocument();
    fireEvent.click(within(ventana).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Guardar cambios" }),
    ).toBeDisabled();
    expect(
      screen.queryByText("Esta entrega se quitará al guardar."),
    ).toBeNull();
  });

  it("quitar entrega: singular correcto (1 producto, 1 pieza)", async () => {
    fetchEstadoModificar.mockResolvedValue(
      estado({
        dias: estado().dias.map((d) =>
          d.fecha === "2026-10-02" && d.entrega
            ? {
                ...d,
                entrega: {
                  ...d.entrega,
                  productos: [
                    {
                      productId: "A",
                      nombre: "Café americano",
                      cantidad: 1,
                      precioUnitario: 45,
                    },
                  ],
                },
              }
            : d,
        ),
      }),
    );
    render(<Page />);
    await screen.findByRole("button", { name: "Guardar cambios" });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Quitar este día" })[0],
    );
    expect(
      await screen.findByText(/Se quitarán 1 producto \(1 pieza\)/),
    ).toBeInTheDocument();
  });

  it("las fechas salen como «Vie 2 oct» (solo la primera letra en mayúscula), no «Vie 2 De Oct»", async () => {
    render(<Page />);
    await screen.findByRole("button", { name: "Guardar cambios" });
    const titulos = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(titulos).toContain("Vie 2 oct");
    expect(titulos).toContain("Sáb 3 oct");
    for (const t of titulos) expect(t).not.toMatch(/ De | Oct/);
    // El estilo no debe volver a capitalizar cada palabra.
    const h = screen.getByRole("heading", { level: 2, name: "Vie 2 oct" });
    expect(h.className).not.toMatch(/capitalize/);
  });
});

describe("modificar pedido: «Atrás» vuelve al origen", () => {
  const atras = async () =>
    (await screen.findByRole("link", { name: "Atrás" })).getAttribute("href");

  it("sin origen (URL directa) o desde el menú: al menú", async () => {
    render(<Page />);
    expect(await atras()).toBe("/mayoreo/banetto");
  });

  it("desde el menú con un solo pedido: al menú", async () => {
    searchActual = "desde=menu";
    render(<Page />);
    expect(await atras()).toBe("/mayoreo/banetto");
  });

  it("desde la lista de pedidos modificables: a la lista", async () => {
    searchActual = "desde=lista";
    render(<Page />);
    expect(await atras()).toBe("/mayoreo/banetto/portal/modificar?lista=1");
  });

  it("desde el paso de días de «Crear pedido»: de regreso a ese paso", async () => {
    searchActual = "desde=dias";
    render(<Page />);
    expect(await atras()).toBe("/mayoreo/banetto?vista=crear");
  });

  it("desde el detalle del pedido: al detalle", async () => {
    searchActual = "desde=detalle";
    render(<Page />);
    expect(await atras()).toBe("/mayoreo/banetto/portal/pedidos/P-000001");
  });
});

describe("modificar pedido: control − / + y días cerrados", () => {
  it("«+» suma una pieza, «−» resta y no baja de 0; el número también se escribe", async () => {
    render(<Page />);
    const campo = (await screen.findByLabelText(
      /Café americano el .*3 oct/i,
    )) as HTMLInputElement;
    const antes = Number(campo.value);
    fireEvent.click(
      screen.getByRole("button", {
        name: /Una pieza más: Café americano \(.*3 oct\)/,
      }),
    );
    expect(Number(campo.value)).toBe(antes + 1);
    fireEvent.change(campo, { target: { value: "0" } });
    expect(
      screen.getByRole("button", {
        name: /Una pieza menos: Café americano \(.*3 oct\)/,
      }),
    ).toBeDisabled();
  });

  it("los días cerrados van juntos en una tarjeta, sin controles de edición", async () => {
    render(<Page />);
    await screen.findByLabelText(/Café americano el .*3 oct/i);
    const cerrado = screen.getByRole("heading", { name: /1 oct/ });
    const tarjeta = cerrado.closest("section")!;
    expect(within(tarjeta).queryByRole("spinbutton")).toBeNull();
    expect(
      within(tarjeta).queryByRole("button", { name: /Quitar este día/ }),
    ).toBeNull();
  });
});
