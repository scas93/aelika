import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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

// CAMBIO A PROPÓSITO (reorganización de Notificaciones para mayoreo): las pruebas de mayoreo (tarjetas WhatsApp y Correo con canal/evento
// por separado) pasaron a notificaciones-mayoreo.test.tsx con la pantalla nueva. Aquí queda menudeo/Hotel, que no cambia.
describe("Ajustes · Canales de notificación por tipo de negocio", () => {
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
