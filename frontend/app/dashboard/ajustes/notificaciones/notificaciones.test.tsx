import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { NotificacionCanalConfig, NotificacionEventoConfig } from "@/lib/api";

let tipo = "RETAIL_B2B";
vi.mock("@/lib/session-context", () => ({
  useSession: () => ({ user: { rol: "DUENO", tenant: { tipoStorefront: tipo } }, token: "t" }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard/ajustes/notificaciones" }));
vi.mock("../volver-link", () => ({ default: () => null }));

const fetchNotificacionCanales = vi.fn();
const fetchNotificacionEventos = vi.fn();
const fetchTenantSettings = vi.fn();
const createNotificacionCanal = vi.fn();
const updateNotificacionCanal = vi.fn();
const createNotificacionEvento = vi.fn();
const enviarResumenSemanalPrueba = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchNotificacionCanales, fetchNotificacionEventos, fetchTenantSettings, createNotificacionCanal, updateNotificacionCanal, createNotificacionEvento, enviarResumenSemanalPrueba };
});

const { default: Pagina } = await import("./page");

// CAMBIO A PROPÓSITO (resumen semanal por cliente): la página de mayoreo ahora trae selectores de semana y de cliente de los botones de
// prueba. Los selectores de EVENTO son los que empiezan en «Ninguno»; estas pruebas solo hablan de esos.
const selectoresDeEvento = () =>
  screen.getAllByRole("combobox").filter((c) => (c as HTMLSelectElement).options[0]?.text === "Ninguno") as HTMLSelectElement[];
const { ApiError } = await import("@/lib/api");

const canalCorreo = (extra: Partial<NotificacionCanalConfig> = {}): NotificacionCanalConfig => ({
  id: "m1",
  tenantId: "x",
  tipo: "CORREO",
  activo: false,
  conectado: false,
  config: { nombreRemitente: "Banetto", correos: ["ana@example.com"] },
  ...extra,
});

const canalWa = (extra: Partial<NotificacionCanalConfig> = {}): NotificacionCanalConfig => ({
  id: "c1",
  tenantId: "x",
  tipo: "WHATSAPP",
  activo: false,
  conectado: false,
  config: { destinatarios: [{ id: "d1", nombre: "Ana", telefono: "5512345678" }] },
  ...extra,
});

function datos(opts: { canales?: NotificacionCanalConfig[]; eventos?: NotificacionEventoConfig[]; webhook?: string | null } = {}) {
  fetchNotificacionCanales.mockResolvedValue(opts.canales ?? []);
  fetchNotificacionEventos.mockResolvedValue(opts.eventos ?? []);
  fetchTenantSettings.mockResolvedValue({ botWebhookUrl: opts.webhook === undefined ? "https://bot/hook" : opts.webhook });
}

beforeEach(() => {
  tipo = "RETAIL_B2B";
  [fetchNotificacionCanales, fetchNotificacionEventos, fetchTenantSettings, createNotificacionCanal, updateNotificacionCanal, createNotificacionEvento, enviarResumenSemanalPrueba].forEach((f) => f.mockReset());
});
afterEach(cleanup);

describe("Ajustes · Canales de notificación por tipo de negocio", () => {
  // CAMBIO A PROPÓSITO (resumen semanal por correo): antes mayoreo solo mostraba WhatsApp y no tenía tarjeta de Correo. Ahora tiene la
  // tarjeta «Correo (resumen semanal)» y el evento «Resumen semanal»; Telegram y los eventos de menudeo siguen ocultos.
  it("mayoreo: WhatsApp y Correo (resumen semanal) con sus dos eventos; sin Telegram ni eventos de menudeo", async () => {
    datos();
    render(<Pagina />);
    await screen.findByText("WhatsApp (avisos internos)");
    expect(screen.getByText("Correo (resumen semanal)")).toBeTruthy();
    expect(screen.queryByText("Telegram")).toBeNull();
    expect(screen.getByText("Pedido modificado por el cliente")).toBeTruthy();
    expect(screen.getByText("Resumen semanal")).toBeTruthy();
    for (const t of ["Pedido recibido", "Pago confirmado", "Pedido confirmado", "Pedido en camino", "Pedido entregado", "Para tus clientes"]) {
      expect(screen.queryByText(t)).toBeNull();
    }
  });

  it.each(["RETAIL_B2C", "HOTEL"])("%s: Telegram, Correo y eventos de menudeo como siempre; sin WhatsApp ni evento nuevo; no consulta el webhook", async (t) => {
    tipo = t;
    datos();
    render(<Pagina />);
    await screen.findByText("Telegram");
    expect(screen.getByText("Correo")).toBeTruthy();
    expect(screen.getByText("Pedido recibido")).toBeTruthy();
    expect(screen.getByText("Para tus clientes")).toBeTruthy();
    expect(screen.queryByText("WhatsApp (avisos internos)")).toBeNull();
    expect(screen.queryByText("Pedido modificado por el cliente")).toBeNull();
    expect(screen.queryByText("Resumen semanal")).toBeNull();
    expect(screen.queryByText("Correo (resumen semanal)")).toBeNull();
    expect(fetchTenantSettings).not.toHaveBeenCalled();
  });
});

describe("Tarjeta de WhatsApp", () => {
  it("sin webhook: aviso con enlace a Conexión WhatsApp y el canal no se puede activar", async () => {
    datos({ canales: [canalWa()], webhook: null });
    render(<Pagina />);
    const enlace = await screen.findByRole("link", { name: "Ir a Conexión WhatsApp" });
    expect(enlace.getAttribute("href")).toBe("/dashboard/ajustes/conexion-whatsapp");
    fireEvent.click(screen.getByRole("switch", { name: "Activar WhatsApp" }));
    expect(updateNotificacionCanal).not.toHaveBeenCalled();
  });

  it("con webhook no hay aviso y el interruptor activa el canal", async () => {
    datos({ canales: [canalWa()] });
    updateNotificacionCanal.mockResolvedValue({});
    render(<Pagina />);
    await screen.findByText("WhatsApp (avisos internos)");
    expect(screen.queryByRole("link", { name: "Ir a Conexión WhatsApp" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Activar WhatsApp" }));
    await waitFor(() => expect(updateNotificacionCanal).toHaveBeenCalledWith("t", "c1", { activo: true }));
  });

  it("muestra la lista guardada y permite agregar y quitar; máximo 10", async () => {
    datos({ canales: [canalWa()] });
    render(<Pagina />);
    expect(((await screen.findByLabelText("Nombre del destinatario 1")) as HTMLInputElement).value).toBe("Ana");
    expect((screen.getByLabelText("Teléfono del destinatario 1") as HTMLInputElement).value).toBe("5512345678");
    const agregar = screen.getByRole("button", { name: "Agregar destinatario" }) as HTMLButtonElement;
    for (let i = 0; i < 9; i++) fireEvent.click(agregar);
    expect(screen.getAllByLabelText(/^Nombre del destinatario/)).toHaveLength(10);
    expect(agregar.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Quitar al destinatario 10" }));
    expect(screen.getAllByLabelText(/^Nombre del destinatario/)).toHaveLength(9);
    expect(agregar.disabled).toBe(false);
  });

  it("la fila del destinatario no desborda la tarjeta: campos que se encogen, botón fijo y tarjeta que cabe en su columna", async () => {
    datos({ canales: [canalWa()] });
    render(<Pagina />);
    const nombre = await screen.findByLabelText("Nombre del destinatario 1");
    const telefono = screen.getByLabelText("Teléfono del destinatario 1");
    for (const campo of [nombre, telefono]) {
      expect(campo.className).toContain("min-w-0");
      expect(campo.className).toContain("w-full");
      expect(campo.className).toContain("truncate");
    }
    const quitar = screen.getByRole("button", { name: "Quitar al destinatario 1" });
    expect(quitar.className).toContain("shrink-0");
    expect(nombre.parentElement!.className).toContain("min-w-0");
    expect(nombre.parentElement!.className).toContain("flex-col");
    // La tarjeta es un ítem de grid: sin min-w-0 se estiraría más que su columna.
    expect(nombre.closest("form")!.parentElement!.className).toContain("min-w-0");
  });

  it("guardar manda los destinatarios recortados, y un canal nuevo nace inactivo", async () => {
    datos();
    createNotificacionCanal.mockResolvedValue({});
    render(<Pagina />);
    fireEvent.click(await screen.findByRole("button", { name: "Agregar destinatario" }));
    fireEvent.change(screen.getByLabelText("Nombre del destinatario 1"), { target: { value: "  Luis  " } });
    fireEvent.change(screen.getByLabelText("Teléfono del destinatario 1"), { target: { value: "+1 818 814 0000" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Guardar" })[0] /* la de WhatsApp: ahora mayoreo tiene también la tarjeta de Correo */);
    await waitFor(() =>
      expect(createNotificacionCanal).toHaveBeenCalledWith("t", {
        tipo: "WHATSAPP",
        config: { destinatarios: [{ nombre: "Luis", telefono: "+1 818 814 0000" }] },
        activo: false,
      }),
    );
  });

  it("editar un canal existente conserva la id del destinatario; un error del servidor se muestra", async () => {
    datos({ canales: [canalWa({ activo: true })] });
    updateNotificacionCanal.mockRejectedValue(new ApiError("Máximo 10 destinatarios", 400));
    render(<Pagina />);
    fireEvent.change(await screen.findByLabelText("Nombre del destinatario 1"), { target: { value: "Ana M." } });
    fireEvent.click(screen.getAllByRole("button", { name: "Guardar" })[0] /* la de WhatsApp: ahora mayoreo tiene también la tarjeta de Correo */);
    await waitFor(() =>
      expect(updateNotificacionCanal).toHaveBeenCalledWith("t", "c1", {
        config: { destinatarios: [{ id: "d1", nombre: "Ana M.", telefono: "5512345678" }] },
      }),
    );
    expect(await screen.findByText("Máximo 10 destinatarios")).toBeTruthy();
  });

  it("el evento nuevo no ofrece un WhatsApp inactivo", async () => {
    datos({ canales: [canalWa({ activo: false })] });
    render(<Pagina />);
    await screen.findByText("Pedido modificado por el cliente");
    expect(screen.queryByRole("option", { name: "WhatsApp" })).toBeNull();
  });

  it("con WhatsApp activo el evento nuevo lo ofrece y crea la fila con audiencia NEGOCIO", async () => {
    datos({ canales: [canalWa({ activo: true })] });
    createNotificacionEvento.mockResolvedValue({});
    render(<Pagina />);
    await screen.findByRole("option", { name: "WhatsApp" });
    fireEvent.change(selectoresDeEvento()[0], { target: { value: "c1" } });
    await waitFor(() =>
      expect(createNotificacionEvento).toHaveBeenCalledWith("t", {
        evento: "PEDIDO_MODIFICADO_CLIENTE",
        audiencia: "NEGOCIO",
        canalConfigId: "c1",
        activo: true,
      }),
    );
  });
});

describe("Tarjeta de Correo (resumen semanal, mayoreo)", () => {
  it("guardar manda nombre y direcciones recortadas, y un canal nuevo nace inactivo", async () => {
    datos();
    createNotificacionCanal.mockResolvedValue({});
    render(<Pagina />);
    fireEvent.click(await screen.findByRole("button", { name: "Agregar dirección" }));
    fireEvent.change(screen.getByLabelText("Dirección de correo 1"), { target: { value: "  ana@example.com " } });
    fireEvent.change(screen.getByPlaceholderText("Nombre de tu negocio"), { target: { value: " Banetto " } });
    const guardar = screen.getAllByRole("button", { name: "Guardar" }).at(-1)!;
    fireEvent.click(guardar);
    await waitFor(() =>
      expect(createNotificacionCanal).toHaveBeenCalledWith("t", {
        tipo: "CORREO",
        config: { nombreRemitente: "Banetto", correos: ["ana@example.com"] },
        activo: false,
      }),
    );
  });

  it("máximo 10 direcciones; quitar libera el lugar", async () => {
    datos({ canales: [canalCorreo()] });
    render(<Pagina />);
    await screen.findByLabelText("Dirección de correo 1");
    const agregar = screen.getByRole("button", { name: "Agregar dirección" }) as HTMLButtonElement;
    for (let i = 0; i < 9; i++) fireEvent.click(agregar);
    expect(screen.getAllByLabelText(/^Dirección de correo/)).toHaveLength(10);
    expect(agregar.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Quitar la dirección 10" }));
    expect(agregar.disabled).toBe(false);
  });

  it("sin direcciones guardadas no se puede activar ni probar; con una, el interruptor activa el canal", async () => {
    datos({ canales: [canalCorreo({ config: { nombreRemitente: "Banetto", correos: [] } })] });
    const { unmount } = render(<Pagina />);
    await screen.findByText("Correo (resumen semanal)");
    fireEvent.click(screen.getByRole("switch", { name: "Activar el resumen semanal por correo" }));
    expect(updateNotificacionCanal).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Enviar resumen de prueba" }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    cleanup();

    datos({ canales: [canalCorreo()] });
    updateNotificacionCanal.mockResolvedValue({});
    render(<Pagina />);
    await screen.findByLabelText("Dirección de correo 1");
    fireEvent.click(screen.getByRole("switch", { name: "Activar el resumen semanal por correo" }));
    await waitFor(() => expect(updateNotificacionCanal).toHaveBeenCalledWith("t", "m1", { activo: true }));
  });

  it("«Enviar resumen de prueba» llama al backend y muestra el resultado o el motivo del fallo", async () => {
    datos({ canales: [canalCorreo()] });
    enviarResumenSemanalPrueba.mockResolvedValueOnce({ resultado: "EXITO", motivo: null, destinatarios: 1, conPedidos: true, semanaInicio: "2026-10-26", semanaFin: "2026-11-01" });
    render(<Pagina />);
    fireEvent.click(await screen.findByRole("button", { name: "Enviar resumen de prueba" }));
    expect(await screen.findByText(/Resumen de prueba enviado a 1 dirección/)).toBeTruthy();
    // CAMBIO A PROPÓSITO: el botón ahora manda la semana elegida (por defecto la anterior, la primera del selector).
    const semanaDefault = (screen.getByLabelText("Semana de la prueba") as HTMLSelectElement).value;
    expect(semanaDefault).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(enviarResumenSemanalPrueba).toHaveBeenCalledWith("t", semanaDefault);

    enviarResumenSemanalPrueba.mockResolvedValueOnce({ resultado: "FALLO", motivo: "Resend: dominio no verificado", destinatarios: 1, conPedidos: false, semanaInicio: "2026-10-26", semanaFin: "2026-11-01" });
    fireEvent.click(screen.getByRole("button", { name: "Enviar resumen de prueba" }));
    expect(await screen.findByText(/No se pudo enviar el resumen de prueba: Resend: dominio no verificado/)).toBeTruthy();
  });

  it("el evento Resumen semanal solo ofrece el Correo activo con direcciones (no WhatsApp) y crea la fila NEGOCIO", async () => {
    datos({ canales: [canalWa({ activo: true }), canalCorreo({ activo: false })] });
    const { unmount } = render(<Pagina />);
    await screen.findByText("Resumen semanal");
    expect(screen.queryByRole("option", { name: "Correo" })).toBeNull(); // correo inactivo
    unmount();
    cleanup();

    datos({ canales: [canalWa({ activo: true }), canalCorreo({ activo: true })] });
    createNotificacionEvento.mockResolvedValue({});
    render(<Pagina />);
    await screen.findByRole("option", { name: "Correo" });
    const selects = selectoresDeEvento();
    // El evento «Pedido modificado» sigue ofreciendo solo WhatsApp; el resumen solo Correo.
    expect(Array.from((selects[0] as HTMLSelectElement).options).map((o) => o.text)).toEqual(["Ninguno", "WhatsApp"]);
    expect(Array.from((selects[1] as HTMLSelectElement).options).map((o) => o.text)).toEqual(["Ninguno", "Correo"]);
    fireEvent.change(selects[1], { target: { value: "m1" } });
    await waitFor(() =>
      expect(createNotificacionEvento).toHaveBeenCalledWith("t", { evento: "RESUMEN_SEMANAL", audiencia: "NEGOCIO", canalConfigId: "m1", activo: true }),
    );
  });
});
