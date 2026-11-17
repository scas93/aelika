import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { PaginatedClientesB2b } from "@/lib/api";

vi.mock("@/lib/session-context", () => ({ useSession: () => ({ user: { rol: "GERENTE" }, token: "t" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard/clientes" }));
vi.mock("./cliente-b2b-form", () => ({ default: () => null }));
vi.mock("./cliente-b2b-panel", () => ({ default: () => null }));

const fetchClientesB2b = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchClientesB2b };
});

const { default: ClientesB2b } = await import("./clientes-b2b");

const cliente = (n: number) => ({
  id: `c${n}`,
  codigo: null,
  nombre: `Cliente ${n}`,
  direccion: null,
  descuentoPorcentaje: null,
  modalidadPago: null,
  activo: true,
  bajaAt: null,
  resumenSemanalActivo: false,
  resumenSemanalCorreo: null,
  telefonoPrincipal: null,
  nombreContactoPrincipal: null,
  pedidosActivos: 0,
  incompleto: false,
  createdAt: "2026-10-01T00:00:00.000Z",
});
const respuesta = (ns: number[]) =>
  ({ data: ns.map(cliente), total: ns.length, page: 1, limit: 25, totalPages: 1 }) as unknown as PaginatedClientesB2b;

describe("Clientes B2B: tabla al cambiar filtros", () => {
  beforeEach(() => fetchClientesB2b.mockReset());
  afterEach(cleanup);

  it("se atenúa YA al elegir un filtro, no se vacía, y vuelve a la normalidad al llegar la respuesta", async () => {
    fetchClientesB2b.mockResolvedValueOnce(respuesta([1, 2]));
    render(<ClientesB2b />);
    await screen.findByText("Cliente 1");
    const zona = () => document.querySelector("[aria-busy]") as HTMLElement;
    await waitFor(() => expect(zona().getAttribute("aria-busy")).toBe("false"));
    let resolver!: (r: PaginatedClientesB2b) => void;
    fetchClientesB2b.mockReturnValueOnce(new Promise<PaginatedClientesB2b>((r) => (resolver = r)));
    fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Estado$/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Todos" }));
    expect(zona().getAttribute("aria-busy")).toBe("true");
    expect(zona().className).toContain("opacity-50");
    expect(screen.getByText("Cliente 2")).toBeTruthy();
    resolver(respuesta([1]));
    await waitFor(() => expect(zona().getAttribute("aria-busy")).toBe("false"));
    expect(zona().className).not.toContain("opacity-50");
    expect(screen.queryByText("Cliente 2")).toBeNull();
  });
});
