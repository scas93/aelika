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
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchNotificacionCanales, fetchNotificacionEventos, fetchTenantSettings, createNotificacionCanal, updateNotificacionCanal, createNotificacionEvento };
});

const { default: Pagina } = await import("./page");
const { ApiError } = await import("@/lib/api");

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
  [fetchNotificacionCanales, fetchNotificacionEventos, fetchTenantSettings, createNotificacionCanal, updateNotificacionCanal, createNotificacionEvento].forEach((f) => f.mockReset());
});
afterEach(cleanup);

describe("Ajustes · Canales de notificación por tipo de negocio", () => {
  it("mayoreo: solo WhatsApp y el evento nuevo; sin Telegram, Correo ni eventos de menudeo", async () => {
    datos();
    render(<Pagina />);
    await screen.findByText("WhatsApp (avisos internos)");
    expect(screen.queryByText("Telegram")).toBeNull();
    expect(screen.queryByText("Correo")).toBeNull();
    expect(screen.getByText("Pedido modificado por el cliente")).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
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
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "c1" } });
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
