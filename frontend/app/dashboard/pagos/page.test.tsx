import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { PaginatedPayments } from "@/lib/api";

vi.mock("@/lib/session-context", () => ({ useSession: () => ({ user: { rol: "GERENTE" }, token: "t" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard/pagos" }));

const fetchPayments = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchPayments };
});

const { default: Pagos } = await import("./page");

const pago = (n: number) => ({
  id: `p${n}`,
  amount: "100",
  currency: "mxn",
  status: "PAGADO",
  paymentMethodType: "card",
  cardBrand: "visa",
  last4: "4242",
  capturedAt: "2026-10-01T12:00:00.000Z",
  createdAt: "2026-10-01T12:00:00.000Z",
  folio: `F${n}`,
});
const respuesta = (ns: number[]) =>
  ({ data: ns.map(pago), total: ns.length, page: 1, limit: 25, totalPages: 1 }) as unknown as PaginatedPayments;

describe("Pagos: tabla al cambiar filtros", () => {
  beforeEach(() => fetchPayments.mockReset());
  afterEach(cleanup);

  it("se atenúa YA al elegir un filtro, no se vacía, y vuelve a la normalidad al llegar la respuesta", async () => {
    fetchPayments.mockResolvedValueOnce(respuesta([1, 2]));
    render(<Pagos />);
    await screen.findByText("#F1");
    const zona = () => document.querySelector("[aria-busy]") as HTMLElement;
    expect(zona().getAttribute("aria-busy")).toBe("false");
    let resolver!: (r: PaginatedPayments) => void;
    fetchPayments.mockReturnValueOnce(new Promise<PaginatedPayments>((r) => (resolver = r)));
    fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Estado$/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Fallido" }));
    expect(zona().getAttribute("aria-busy")).toBe("true");
    expect(zona().className).toContain("opacity-50");
    expect(screen.getByText("#F2")).toBeTruthy();
    resolver(respuesta([1]));
    await waitFor(() => expect(zona().getAttribute("aria-busy")).toBe("false"));
    expect(zona().className).not.toContain("opacity-50");
    expect(screen.queryByText("#F2")).toBeNull();
  });
});
