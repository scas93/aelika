import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { PaginatedOrders } from "@/lib/api";

vi.mock("@/lib/session-context", () => ({ useSession: () => ({ user: { rol: "GERENTE" }, token: "t" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard/pedidos/historico" }));

const fetchOrdersHistorico = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchOrdersHistorico };
});

const { default: Historico } = await import("./page");

const orden = (n: number) => ({
  id: `o${n}`,
  folio: n,
  clienteNombre: `Cliente ${n}`,
  createdAt: "2026-10-01T12:00:00.000Z",
  estadoPedido: "DESPACHADO",
  metodoPago: "EFECTIVO",
  estadoPago: "PAGADO",
  total: "100",
});
const respuesta = (ns: number[]) =>
  ({ data: ns.map(orden), total: ns.length, page: 1, limit: 25, totalPages: 1 }) as unknown as PaginatedOrders;

describe("Históricos de pedidos (menudeo): tabla al cambiar filtros", () => {
  beforeEach(() => fetchOrdersHistorico.mockReset());
  afterEach(cleanup);

  it("se atenúa YA al elegir un filtro, no se vacía, y vuelve a la normalidad al llegar la respuesta", async () => {
    fetchOrdersHistorico.mockResolvedValueOnce(respuesta([1, 2]));
    render(<Historico />);
    await screen.findByText("Cliente 1");
    const zona = () => document.querySelector("[aria-busy]") as HTMLElement;
    expect(zona().getAttribute("aria-busy")).toBe("false");
    let resolver!: (r: PaginatedOrders) => void;
    fetchOrdersHistorico.mockReturnValueOnce(new Promise<PaginatedOrders>((r) => (resolver = r)));
    fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Estado$/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Despachado" }));
    expect(zona().getAttribute("aria-busy")).toBe("true");
    expect(zona().className).toContain("opacity-50");
    expect(screen.getByText("Cliente 2")).toBeTruthy();
    resolver(respuesta([1]));
    await waitFor(() => expect(zona().getAttribute("aria-busy")).toBe("false"));
    expect(zona().className).not.toContain("opacity-50");
    expect(screen.queryByText("Cliente 2")).toBeNull();
  });
});
