import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { puedeVerAjustes, puedeVerSubmodulo } from "./acceso";

let sesion: { token: string; user: { rol: string; tenant: { tipoStorefront: string } } };
vi.mock("@/lib/session-context", () => ({ useSession: () => sesion }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

const fetchDiasSinEntrega = vi.fn();
const marcarDiaSinEntrega = vi.fn();
const quitarDiaSinEntrega = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchDiasSinEntrega, marcarDiaSinEntrega, quitarDiaSinEntrega };
});

const { default: Pagina } = await import("./dias-sin-entrega/page");

afterEach(() => {
  cleanup();
  fetchDiasSinEntrega.mockReset();
  marcarDiaSinEntrega.mockReset();
  quitarDiaSinEntrega.mockReset();
});

const sesionDe = (rol: string, tipoStorefront = "RETAIL_B2B") => ({ token: "t", user: { rol, tenant: { tipoStorefront } } });

describe("Ajustes → Días sin entrega · permisos", () => {
  it("Admin y Gerente la ven; el Operador no", () => {
    expect(puedeVerSubmodulo("DUENO", "/dashboard/ajustes/dias-sin-entrega")).toBe(true);
    expect(puedeVerSubmodulo("GERENTE", "/dashboard/ajustes/dias-sin-entrega")).toBe(true);
    expect(puedeVerAjustes("OPERADOR")).toBe(false);
    expect(puedeVerSubmodulo("OPERADOR", "/dashboard/ajustes/dias-sin-entrega")).toBe(false);
    // El Gerente sigue sin ver el resto de Ajustes.
    expect(puedeVerSubmodulo("GERENTE", "/dashboard/ajustes/pedidos-b2b")).toBe(false);
  });

  it("el Operador que llega por URL no ve la sección ni se llama a la API", () => {
    sesion = sesionDe("OPERADOR");
    render(<Pagina />);
    expect(screen.getByText(/no tiene acceso a los ajustes/)).toBeTruthy();
    expect(fetchDiasSinEntrega).not.toHaveBeenCalled();
  });

  it("un negocio de menudeo ve que no aplica", () => {
    sesion = sesionDe("DUENO", "RETAIL_B2C");
    render(<Pagina />);
    expect(screen.getByText(/solo aplica a negocios de mayoreo/)).toBeTruthy();
    expect(fetchDiasSinEntrega).not.toHaveBeenCalled();
  });
});

describe("Ajustes → Días sin entrega · uso (Gerente)", () => {
  it("lista las fechas con su nota", async () => {
    sesion = sesionDe("GERENTE");
    fetchDiasSinEntrega.mockResolvedValue([{ id: "d1", fecha: "2026-12-25", nota: "Navidad" }]);
    render(<Pagina />);
    expect(await screen.findByText("Navidad")).toBeTruthy();
    expect(screen.getByText(/25 de dic de 2026/)).toBeTruthy();
  });

  it("marcar una fecha con entregas muestra cuántas y de qué clientes, sin que se modifique nada", async () => {
    sesion = sesionDe("GERENTE");
    fetchDiasSinEntrega.mockResolvedValue([]);
    marcarDiaSinEntrega.mockResolvedValue({
      dia: { id: "d2", fecha: "2026-12-25", nota: "Navidad" },
      afectadas: {
        total: 2,
        entregas: [
          { folio: "B-1", cliente: "Cafetería Sol", estadoPedido: "CONFIRMADO_SURTIENDO", pagado: false },
          { folio: "B-2", cliente: "Panadería Luna", estadoPedido: "PENDIENTE_CONFIRMACION", pagado: true },
        ],
      },
    });
    const { container } = render(<Pagina />);
    await screen.findByText("Aún no hay días sin entrega.");
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: "2026-12-25" } });
    fireEvent.change(container.querySelector('input[type="text"]')!, { target: { value: "Navidad" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar sin entrega" }));
    await waitFor(() => expect(marcarDiaSinEntrega).toHaveBeenCalledWith("t", { fecha: "2026-12-25", nota: "Navidad" }));
    expect(await screen.findByText(/Hay 2 entregas programadas ese día/)).toBeTruthy();
    expect(screen.getByText(/Cafetería Sol · pedido B-1/)).toBeTruthy();
    expect(screen.getByText(/Panadería Luna · pedido B-2 \(pagado\)/)).toBeTruthy();
    expect(screen.getByText(/No se modificaron ni se cancelaron/)).toBeTruthy();
  });

  it("sin entregas ese día lo dice; un 409 del servidor se muestra", async () => {
    sesion = sesionDe("DUENO");
    fetchDiasSinEntrega.mockResolvedValue([]);
    marcarDiaSinEntrega.mockResolvedValueOnce({
      dia: { id: "d2", fecha: "2026-12-25", nota: null },
      afectadas: { total: 0, entregas: [] },
    });
    const { container } = render(<Pagina />);
    await screen.findByText("Aún no hay días sin entrega.");
    fireEvent.change(container.querySelector('input[type="date"]')!, { target: { value: "2026-12-25" } });
    fireEvent.click(screen.getByRole("button", { name: "Marcar sin entrega" }));
    expect(await screen.findByText("No hay entregas programadas ese día.")).toBeTruthy();
  });

  it("quitar una fecha la saca de la lista", async () => {
    sesion = sesionDe("GERENTE");
    fetchDiasSinEntrega.mockResolvedValue([{ id: "d1", fecha: "2026-12-25", nota: null }]);
    quitarDiaSinEntrega.mockResolvedValue(undefined);
    render(<Pagina />);
    fireEvent.click(await screen.findByRole("button", { name: /Quitar/ }));
    await waitFor(() => expect(quitarDiaSinEntrega).toHaveBeenCalledWith("t", "d1"));
    expect(await screen.findByText("Aún no hay días sin entrega.")).toBeTruthy();
  });
});
