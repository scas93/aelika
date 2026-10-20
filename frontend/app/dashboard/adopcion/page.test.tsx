import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { AdopcionClientes, AdopcionInterno } from "@/lib/api";

let usuario: { rol: string; tenant: { tipoStorefront: string } } = { rol: "DUENO", tenant: { tipoStorefront: "RETAIL_B2B" } };
vi.mock("@/lib/session-context", () => ({ useSession: () => ({ user: usuario, token: "t" }) }));

const fetchAdopcionClientes = vi.fn();
const fetchAdopcionInterno = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchAdopcionClientes, fetchAdopcionInterno };
});
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const { default: AdopcionPage } = await import("./page");

const vacioOrigen = { casos: 0, portal: 0, panel: 0, porcentajePortal: null, porcentajePanel: null };
const clientes: AdopcionClientes = {
  semana: { inicio: "2026-10-05", fin: "2026-10-11", esActual: false, esProxima: true, enCurso: "2026-09-28", proxima: "2026-10-05" },
  avisos: { confirmadoAtDesde: null },
  resumen: {
    totalClientes: 1,
    pidieron: 0,
    sinConfirmar: 0,
    habitualesSinPedir: 1,
    cancelaron: 0,
    porEstado: { PIDIO: 0, SIN_CONFIRMAR: 0, CANCELADO: 0, NO_HA_PEDIDO_HABITUAL: 1, NO_HA_PEDIDO: 0 },
  },
  clientes: [
    {
      id: "1",
      nombre: "Café Aurora",
      codigo: "banetto-aurora",
      estado: "NO_HA_PEDIDO_HABITUAL",
      etapa: "ACCEDIO",
      ultimoAccesoAt: null,
      primerPedidoAt: null,
      pedidosUltimas4Semanas: 2,
      modificadoSinReconfirmar: true,
      pedidoId: null,
      folio: null,
      origen: vacioOrigen,
    },
  ],
  canceladosDespuesDeConfirmar: [],
  origen: vacioOrigen,
};
const interno: AdopcionInterno = {
  hoy: "2026-09-30",
  semanaEnCurso: "2026-09-28",
  avisos: { confirmadoAtDesde: null },
  sinConfirmar: {
    total: 1,
    items: [{ pedidoId: "p1", folio: "P-000007", cliente: "Café Aurora", semana: "2026-09-21", recibidoAt: "2026-09-27T18:00:00.000Z", horasEspera: 60, deSemanaPasada: true }],
  },
  entregasAtrasadas: { total: 0, items: [] },
  semanasPasadasSinCompletar: { total: 0, items: [] },
  tiempos: {
    ventanaDias: 28,
    pedidosEnVentana: 5,
    recibidoAConfirmado: { casos: 0, medianaHoras: null, maximoHoras: null },
    puntualidad: { casos: 0, aTiempo: 0, despues: 0, sinDato: 0, porcentajeATiempo: null },
    noRecogidas: 0,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  usuario = { rol: "DUENO", tenant: { tipoStorefront: "RETAIL_B2B" } };
  fetchAdopcionClientes.mockResolvedValue(clientes);
  fetchAdopcionInterno.mockResolvedValue(interno);
});
afterEach(cleanup);

describe("AdopcionPage", () => {
  it("un Gerente o un negocio de menudeo no ve el módulo ni consume sus endpoints", () => {
    usuario = { rol: "GERENTE", tenant: { tipoStorefront: "RETAIL_B2B" } };
    render(<AdopcionPage />);
    expect(screen.getByText(/Solo el dueño de un negocio de mayoreo/)).toBeTruthy();
    cleanup();
    usuario = { rol: "DUENO", tenant: { tipoStorefront: "RETAIL_B2C" } };
    render(<AdopcionPage />);
    expect(screen.getByText(/Solo el dueño de un negocio de mayoreo/)).toBeTruthy();
    expect(fetchAdopcionClientes).not.toHaveBeenCalled();
  });

  it("Clientes: muestra el estado, la etapa, 'Sin registro' y la marca de modificado; sin semana pide la próxima", async () => {
    render(<AdopcionPage />);
    await waitFor(() => expect(screen.getByText("Café Aurora")).toBeTruthy());
    expect(fetchAdopcionClientes).toHaveBeenCalledWith("t", undefined);
    expect(screen.getAllByText("No ha pedido (habitual)").length).toBeGreaterThan(0);
    expect(screen.getByText("Accedió")).toBeTruthy();
    expect(screen.getByText("Sin registro")).toBeTruthy();
    expect(screen.getByText("Modificó, sin reconfirmar")).toBeTruthy();
    expect(screen.getAllByText("Sin dato").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Aún no hay datos.").length).toBeGreaterThan(0); // cancelados / origen total
  });

  it("Interno: lista con enlace directo al pedido y tiempos con sus casos", async () => {
    render(<AdopcionPage />);
    (await screen.findByText("Interno")).click();
    const enlace = await screen.findByText("P-000007");
    expect(enlace.getAttribute("href")).toBe("/dashboard/pedidos-b2b?pedido=p1");
    expect(screen.getByText("Semana anterior")).toBeTruthy();
    expect(screen.getByText(/Medido en 0 de 5 pedidos recibidos/)).toBeTruthy();
  });
});
