import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { NotificacionCanalConfig, NotificacionEventoConfig } from "@/lib/api";

// Ajustes → Notificaciones de MAYOREO, reorganizado en una tarjeta completa por aviso (agrupadas por quién lo recibe). Reemplaza las
// pruebas que hablaban de «canales» y «eventos» por separado: ahora cada tarjeta tiene UN interruptor que maneja canal y evento juntos.

vi.mock("@/lib/session-context", () => ({
  useSession: () => ({ user: { rol: "DUENO", tenant: { tipoStorefront: "RETAIL_B2B", nombre: "Banetto" } }, token: "t" }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard/ajustes/notificaciones" }));
vi.mock("../volver-link", () => ({ default: () => null }));

const fetchNotificacionCanales = vi.fn();
const fetchNotificacionEventos = vi.fn();
const fetchTenantSettings = vi.fn();
const createNotificacionCanal = vi.fn();
const updateNotificacionCanal = vi.fn();
const createNotificacionEvento = vi.fn();
const updateNotificacionEvento = vi.fn();
const enviarResumenSemanalPrueba = vi.fn();
const fetchResumenClientesConfig = vi.fn();
const guardarResumenClientesConfig = vi.fn();
const fetchClientesB2bSelector = vi.fn();
const enviarResumenClientePrueba = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchNotificacionCanales,
    fetchNotificacionEventos,
    fetchTenantSettings,
    createNotificacionCanal,
    updateNotificacionCanal,
    createNotificacionEvento,
    updateNotificacionEvento,
    enviarResumenSemanalPrueba,
    fetchResumenClientesConfig,
    guardarResumenClientesConfig,
    fetchClientesB2bSelector,
    enviarResumenClientePrueba,
  };
});

const { default: Pagina } = await import("./page");
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

const evento = (
  e: NotificacionEventoConfig["evento"],
  audiencia: NotificacionEventoConfig["audiencia"],
  canal: NotificacionCanalConfig,
  activo: boolean,
  id = `ev-${e}-${audiencia}`,
): NotificacionEventoConfig => ({ id, tenantId: "x", evento: e, audiencia, canalConfigId: canal.id, activo, canalConfig: canal });

function datos(opts: { canales?: NotificacionCanalConfig[]; eventos?: NotificacionEventoConfig[]; webhook?: string | null; clientesConEnvio?: number } = {}) {
  fetchNotificacionCanales.mockResolvedValue(opts.canales ?? []);
  fetchNotificacionEventos.mockResolvedValue(opts.eventos ?? []);
  fetchTenantSettings.mockResolvedValue({ botWebhookUrl: opts.webhook === undefined ? "https://bot/hook" : opts.webhook });
  fetchResumenClientesConfig.mockResolvedValue({ correoRespuestas: null, clientesConEnvio: opts.clientesConEnvio ?? 0 });
}

const TARJETAS = ["Pedido modificado por un cliente", "Resumen semanal del negocio", "Resumen semanal para clientes"];
const tarjeta = (titulo: string) => screen.getByRole("group", { name: titulo });
const interruptor = (titulo: string) => within(tarjeta(titulo)).getByRole("switch") as HTMLButtonElement;

beforeEach(() => {
  [
    fetchNotificacionCanales, fetchNotificacionEventos, fetchTenantSettings, createNotificacionCanal, updateNotificacionCanal,
    createNotificacionEvento, updateNotificacionEvento, enviarResumenSemanalPrueba, fetchResumenClientesConfig,
    guardarResumenClientesConfig, fetchClientesB2bSelector, enviarResumenClientePrueba,
  ].forEach((f) => f.mockReset());
  fetchClientesB2bSelector.mockResolvedValue([{ id: "c1", nombre: "Café Aurora", codigo: "b-a", descuentoPorcentaje: null }]);
});
afterEach(cleanup);

describe("Notificaciones de mayoreo: estructura", () => {
  it("título, dos grupos y tres tarjetas; sin las palabras canal, evento ni audiencia", async () => {
    datos();
    render(<Pagina />);
    await screen.findByRole("group", { name: TARJETAS[0] });
    expect(screen.getByRole("heading", { name: "Notificaciones", level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Para tu equipo" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Para tus clientes" })).toBeTruthy();
    for (const t of TARJETAS) expect(tarjeta(t)).toBeTruthy();
    expect(screen.getAllByRole("switch")).toHaveLength(3);
    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(/canal|evento|audiencia|Telegram|Ninguno|Sin configurar|Inactivo/i);
    expect(screen.queryByRole("heading", { name: "Eventos" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Canales" })).toBeNull();
  });

  it("cada tarjeta muestra Encendido/Apagado, a quién se envía y lo que falta", async () => {
    datos({
      canales: [canalWa({ activo: true }), canalCorreo({ config: { nombreRemitente: "Banetto", correos: [] } })],
      eventos: [evento("PEDIDO_MODIFICADO_CLIENTE", "NEGOCIO", canalWa(), true)],
      clientesConEnvio: 3,
    });
    render(<Pagina />);
    await screen.findByRole("group", { name: TARJETAS[0] });
    const wa = within(tarjeta(TARJETAS[0]));
    expect(wa.getByText("Encendido")).toBeTruthy();
    expect(wa.getByText(/1 persona: Ana/)).toBeTruthy();
    const negocio = within(tarjeta(TARJETAS[1]));
    expect(negocio.getByText("Apagado")).toBeTruthy();
    expect(negocio.getByText("Nadie todavía")).toBeTruthy();
    expect(negocio.getByText("Agrega al menos una dirección para poder encenderlo.")).toBeTruthy();
    const clientes = within(tarjeta(TARJETAS[2]));
    expect(clientes.getByText("Apagado")).toBeTruthy();
    await waitFor(() => expect(clientes.getByText(/3 clientes, a su propio correo/)).toBeTruthy());
  });

  it("las tres tarjetas son independientes: encender una no toca las otras", async () => {
    datos({ canales: [canalCorreo()] });
    updateNotificacionCanal.mockResolvedValue({});
    createNotificacionEvento.mockResolvedValue({});
    render(<Pagina />);
    await screen.findByRole("group", { name: TARJETAS[1] });
    fireEvent.click(interruptor(TARJETAS[1]));
    await waitFor(() => expect(createNotificacionEvento).toHaveBeenCalledTimes(1));
    expect(createNotificacionEvento.mock.calls[0][1]).toMatchObject({ evento: "RESUMEN_SEMANAL", audiencia: "NEGOCIO" });
    expect(createNotificacionCanal).not.toHaveBeenCalled();
    expect(updateNotificacionEvento).not.toHaveBeenCalled();
  });
});

describe("Pedido modificado por un cliente (WhatsApp)", () => {
  it("sin webhook: el interruptor queda deshabilitado, el texto explica y hay enlace a Conexión WhatsApp", async () => {
    datos({ canales: [canalWa()], webhook: null });
    render(<Pagina />);
    const enlace = await screen.findByRole("link", { name: "Ir a Conexión WhatsApp" });
    expect(enlace.getAttribute("href")).toBe("/dashboard/ajustes/conexion-whatsapp");
    expect(within(tarjeta(TARJETAS[0])).getByText("Falta conectar tu WhatsApp para poder encenderlo.")).toBeTruthy();
    expect(interruptor(TARJETAS[0]).disabled).toBe(true);
    fireEvent.click(interruptor(TARJETAS[0]));
    expect(updateNotificacionCanal).not.toHaveBeenCalled();
    expect(createNotificacionEvento).not.toHaveBeenCalled();
  });

  it("sin destinatarios guardados no se puede encender; con cambios sin guardar tampoco", async () => {
    datos({ canales: [] });
    render(<Pagina />);
    await screen.findByRole("group", { name: TARJETAS[0] });
    expect(within(tarjeta(TARJETAS[0])).getByText("Agrega al menos un destinatario para poder encenderlo.")).toBeTruthy();
    expect(interruptor(TARJETAS[0]).disabled).toBe(true);
    cleanup();

    datos({ canales: [canalWa()] });
    render(<Pagina />);
    expect(((await screen.findByLabelText("Nombre del destinatario 1")) as HTMLInputElement).value).toBe("Ana");
    expect(interruptor(TARJETAS[0]).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Nombre del destinatario 1"), { target: { value: "Ana M." } });
    expect(interruptor(TARJETAS[0]).disabled).toBe(true);
    expect(within(tarjeta(TARJETAS[0])).getByText("Guarda los cambios para poder encenderlo.")).toBeTruthy();
  });

  it("un solo interruptor enciende canal y evento: activa el canal y crea el evento NEGOCIO", async () => {
    datos({ canales: [canalWa()] });
    updateNotificacionCanal.mockResolvedValue({});
    createNotificacionEvento.mockResolvedValue({});
    render(<Pagina />);
    await screen.findByLabelText("Nombre del destinatario 1");
    fireEvent.click(interruptor(TARJETAS[0]));
    await waitFor(() => expect(updateNotificacionCanal).toHaveBeenCalledWith("t", "c1", { activo: true }));
    await waitFor(() =>
      expect(createNotificacionEvento).toHaveBeenCalledWith("t", {
        evento: "PEDIDO_MODIFICADO_CLIENTE",
        audiencia: "NEGOCIO",
        canalConfigId: "c1",
        activo: true,
      }),
    );
  });

  it("datos guardados antes (canal activo y evento apagado, o al revés) se enciende completando solo lo que falta", async () => {
    const wa = canalWa({ activo: true });
    datos({ canales: [wa], eventos: [evento("PEDIDO_MODIFICADO_CLIENTE", "NEGOCIO", wa, false, "ev1")] });
    updateNotificacionEvento.mockResolvedValue({});
    render(<Pagina />);
    await screen.findByLabelText("Nombre del destinatario 1");
    expect(within(tarjeta(TARJETAS[0])).getByText("Apagado")).toBeTruthy();
    fireEvent.click(interruptor(TARJETAS[0]));
    await waitFor(() => expect(updateNotificacionEvento).toHaveBeenCalledWith("t", "ev1", { activo: true, canalConfigId: "c1" }));
    expect(updateNotificacionCanal).not.toHaveBeenCalled();
  });

  it("encendido: apagar desactiva el evento y el canal, y nunca se bloquea", async () => {
    const wa = canalWa({ activo: true });
    datos({ canales: [wa], eventos: [evento("PEDIDO_MODIFICADO_CLIENTE", "NEGOCIO", wa, true, "ev1")], webhook: null });
    updateNotificacionEvento.mockResolvedValue({});
    updateNotificacionCanal.mockResolvedValue({});
    render(<Pagina />);
    await screen.findByLabelText("Nombre del destinatario 1");
    expect(interruptor(TARJETAS[0]).disabled).toBe(false);
    fireEvent.click(interruptor(TARJETAS[0]));
    await waitFor(() => expect(updateNotificacionEvento).toHaveBeenCalledWith("t", "ev1", { activo: false }));
    await waitFor(() => expect(updateNotificacionCanal).toHaveBeenCalledWith("t", "c1", { activo: false }));
  });

  it("muestra la lista guardada y permite agregar y quitar; máximo 10", async () => {
    datos({ canales: [canalWa()] });
    render(<Pagina />);
    expect(((await screen.findByLabelText("Teléfono del destinatario 1")) as HTMLInputElement).value).toBe("5512345678");
    const agregar = screen.getByRole("button", { name: "Agregar destinatario" }) as HTMLButtonElement;
    for (let i = 0; i < 9; i++) fireEvent.click(agregar);
    expect(screen.getAllByLabelText(/^Nombre del destinatario/)).toHaveLength(10);
    expect(agregar.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Quitar al destinatario 10" }));
    expect(agregar.disabled).toBe(false);
  });

  it("guardar manda los destinatarios recortados y un canal nuevo nace apagado", async () => {
    datos();
    createNotificacionCanal.mockResolvedValue({});
    render(<Pagina />);
    fireEvent.click(await screen.findByRole("button", { name: "Agregar destinatario" }));
    fireEvent.change(screen.getByLabelText("Nombre del destinatario 1"), { target: { value: "  Luis  " } });
    fireEvent.change(screen.getByLabelText("Teléfono del destinatario 1"), { target: { value: "+1 818 814 0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar destinatarios" }));
    await waitFor(() =>
      expect(createNotificacionCanal).toHaveBeenCalledWith("t", {
        tipo: "WHATSAPP",
        config: { destinatarios: [{ nombre: "Luis", telefono: "+1 818 814 0000" }] },
        activo: false,
      }),
    );
  });

  it("editar conserva la id del destinatario y un error del servidor se muestra", async () => {
    datos({ canales: [canalWa({ activo: true })] });
    updateNotificacionCanal.mockRejectedValue(new ApiError("Máximo 10 destinatarios", 400));
    render(<Pagina />);
    fireEvent.change(await screen.findByLabelText("Nombre del destinatario 1"), { target: { value: "Ana M." } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar destinatarios" }));
    await waitFor(() =>
      expect(updateNotificacionCanal).toHaveBeenCalledWith("t", "c1", {
        config: { destinatarios: [{ id: "d1", nombre: "Ana M.", telefono: "5512345678" }] },
      }),
    );
    expect(await screen.findByText("Máximo 10 destinatarios")).toBeTruthy();
  });

  it("la fila del destinatario no desborda la tarjeta", async () => {
    datos({ canales: [canalWa()] });
    render(<Pagina />);
    const nombre = await screen.findByLabelText("Nombre del destinatario 1");
    for (const campo of [nombre, screen.getByLabelText("Teléfono del destinatario 1")]) {
      expect(campo.className).toContain("min-w-0");
      expect(campo.className).toContain("truncate");
    }
    expect(screen.getByRole("button", { name: "Quitar al destinatario 1" }).className).toContain("shrink-0");
    expect(tarjeta(TARJETAS[0]).className).toContain("min-w-0");
  });
});

describe("Resumen semanal del negocio (correo)", () => {
  it("sin direcciones guardadas no se puede encender; con una, el interruptor enciende canal y evento", async () => {
    datos({ canales: [canalCorreo({ config: { nombreRemitente: "Banetto", correos: [] } })] });
    render(<Pagina />);
    await screen.findByRole("group", { name: TARJETAS[1] });
    expect(interruptor(TARJETAS[1]).disabled).toBe(true);
    expect(within(tarjeta(TARJETAS[1])).getByText("Agrega al menos una dirección para poder encenderlo.")).toBeTruthy();
    cleanup();

    datos({ canales: [canalCorreo()] });
    updateNotificacionCanal.mockResolvedValue({});
    createNotificacionEvento.mockResolvedValue({});
    render(<Pagina />);
    await screen.findByLabelText("Dirección de correo 1");
    fireEvent.click(interruptor(TARJETAS[1]));
    await waitFor(() => expect(updateNotificacionCanal).toHaveBeenCalledWith("t", "m1", { activo: true }));
    await waitFor(() =>
      expect(createNotificacionEvento).toHaveBeenCalledWith("t", { evento: "RESUMEN_SEMANAL", audiencia: "NEGOCIO", canalConfigId: "m1", activo: true }),
    );
  });

  it("guardar manda nombre y direcciones recortadas, y un canal nuevo nace apagado", async () => {
    datos();
    createNotificacionCanal.mockResolvedValue({});
    render(<Pagina />);
    fireEvent.click(await screen.findByRole("button", { name: "Agregar dirección" }));
    fireEvent.change(screen.getByLabelText("Dirección de correo 1"), { target: { value: "  ana@example.com " } });
    fireEvent.change(screen.getByPlaceholderText("Nombre de tu negocio"), { target: { value: " Banetto " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar direcciones" }));
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

  it("«Probar» está plegada y envía la semana elegida; muestra el resultado o el motivo del fallo", async () => {
    datos({ canales: [canalCorreo()] });
    enviarResumenSemanalPrueba.mockResolvedValueOnce({ resultado: "EXITO", motivo: null, destinatarios: 1, conPedidos: true, semanaInicio: "2026-10-26", semanaFin: "2026-11-01" });
    render(<Pagina />);
    await screen.findByLabelText("Dirección de correo 1");
    const plegable = screen.getByText("Probar").closest("details") as HTMLDetailsElement;
    expect(plegable.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Enviar resumen de prueba" }));
    expect(await screen.findByText(/Resumen de prueba enviado a 1 dirección/)).toBeTruthy();
    const semanaDefault = (screen.getByLabelText("Semana de la prueba") as HTMLSelectElement).value;
    expect(enviarResumenSemanalPrueba).toHaveBeenCalledWith("t", semanaDefault);

    enviarResumenSemanalPrueba.mockResolvedValueOnce({ resultado: "FALLO", motivo: "Resend: dominio no verificado", destinatarios: 1, conPedidos: false, semanaInicio: "2026-10-26", semanaFin: "2026-11-01" });
    fireEvent.click(screen.getByRole("button", { name: "Enviar resumen de prueba" }));
    expect(await screen.findByText(/No se pudo enviar el resumen de prueba: Resend: dominio no verificado/)).toBeTruthy();
  });
});

describe("Resumen semanal para clientes", () => {
  it("apagado por defecto; la primera vez crea el canal Correo apagado y el evento, y lo enciende", async () => {
    const canal = canalCorreo({ config: { nombreRemitente: "Banetto", correos: [] } });
    datos();
    createNotificacionCanal.mockResolvedValue(canal);
    createNotificacionEvento.mockResolvedValue({ id: "e1" });
    updateNotificacionEvento.mockResolvedValue({});
    render(<Pagina />);
    await screen.findByRole("group", { name: TARJETAS[2] });
    expect(within(tarjeta(TARJETAS[2])).getByText("Apagado")).toBeTruthy();
    expect(interruptor(TARJETAS[2]).disabled).toBe(false);
    fireEvent.click(interruptor(TARJETAS[2]));
    await waitFor(() => expect(updateNotificacionEvento).toHaveBeenCalledWith("t", "e1", { activo: true }));
    expect(createNotificacionCanal).toHaveBeenCalledWith("t", { tipo: "CORREO", config: { nombreRemitente: "Banetto", correos: [] }, activo: false });
    expect(createNotificacionEvento).toHaveBeenCalledWith("t", { evento: "RESUMEN_SEMANAL", audiencia: "CLIENTE", canalConfigId: "m1" });
  });

  it("con el evento existente solo lo prende o apaga, y conserva la nota del primer envío", async () => {
    const canal = canalCorreo();
    datos({ canales: [canal], eventos: [evento("RESUMEN_SEMANAL", "CLIENTE", canal, true, "e1")] });
    updateNotificacionEvento.mockResolvedValue({});
    render(<Pagina />);
    await screen.findByRole("group", { name: TARJETAS[2] });
    expect(within(tarjeta(TARJETAS[2])).getByText("Encendido")).toBeTruthy();
    expect(within(tarjeta(TARJETAS[2])).getByText(/primer envío es el lunes siguiente/)).toBeTruthy();
    fireEvent.click(interruptor(TARJETAS[2]));
    await waitFor(() => expect(updateNotificacionEvento).toHaveBeenCalledWith("t", "e1", { activo: false }));
    expect(createNotificacionCanal).not.toHaveBeenCalled();
  });

  it("contador de clientes con envío activado y enlace a Clientes (también con 0 y uno solo)", async () => {
    datos({ clientesConEnvio: 4 });
    render(<Pagina />);
    await screen.findByRole("group", { name: TARJETAS[2] });
    await waitFor(() => expect(within(tarjeta(TARJETAS[2])).getByText("Clientes con envío activado: 4")).toBeTruthy());
    expect(within(tarjeta(TARJETAS[2])).getByRole("link", { name: "Ver clientes" }).getAttribute("href")).toBe("/dashboard/clientes");
    cleanup();

    datos({ clientesConEnvio: 0 });
    render(<Pagina />);
    await waitFor(() => expect(within(tarjeta(TARJETAS[2])).getByText("Clientes con envío activado: 0")).toBeTruthy());
    expect(within(tarjeta(TARJETAS[2])).getByText(/Ningún cliente todavía/)).toBeTruthy();
    cleanup();

    datos({ clientesConEnvio: 1 });
    render(<Pagina />);
    await waitFor(() => expect(within(tarjeta(TARJETAS[2])).getByText(/1 cliente, a su propio correo/)).toBeTruthy());
  });

  it("guarda el correo de respuestas", async () => {
    datos();
    guardarResumenClientesConfig.mockResolvedValue({ correoRespuestas: "ventas@banetto.mx" });
    render(<Pagina />);
    const input = (await screen.findByLabelText(/Correo de respuestas/)) as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: " ventas@banetto.mx " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar correo de respuestas" }));
    await waitFor(() => expect(guardarResumenClientesConfig).toHaveBeenCalledWith("t", "ventas@banetto.mx"));
  });

  it("«Probar con un cliente»: elige cliente, semana y dirección, y manda la semana elegida", async () => {
    datos();
    enviarResumenClientePrueba.mockResolvedValue({ resultado: "EXITO", motivo: null, semanaInicio: "2026-09-21", semanaFin: "2026-09-27" });
    render(<Pagina />);
    const boton = (await screen.findByRole("button", { name: "Enviar prueba del cliente" })) as HTMLButtonElement;
    expect(screen.getByText("Probar con un cliente").closest("details")!.open).toBe(false);
    expect(boton.disabled).toBe(true);
    await screen.findByRole("option", { name: "Café Aurora" });
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "c1" } });
    const semana = screen.getByLabelText("Semana") as HTMLSelectElement;
    const segunda = semana.options[1].value;
    fireEvent.change(semana, { target: { value: segunda } });
    fireEvent.change(screen.getByLabelText("Enviar a"), { target: { value: "yo@mio.com" } });
    fireEvent.click(boton);
    await waitFor(() => expect(enviarResumenClientePrueba).toHaveBeenCalledWith("t", { clienteId: "c1", correo: "yo@mio.com", semanaInicio: segunda }));
    expect(await screen.findByText(/Prueba enviada a yo@mio.com/)).toBeTruthy();
  });
});
