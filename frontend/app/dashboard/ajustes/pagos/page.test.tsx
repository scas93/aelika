import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

let sesion: { token: string; user: { rol: string; tenant: { tipoStorefront: string } } };
vi.mock("@/lib/session-context", () => ({ useSession: () => sesion }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
const fetchTenantSettings = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchTenantSettings };
});
const { default: Pagos } = await import("./page");

afterEach(() => {
  cleanup();
  fetchTenantSettings.mockReset();
});

const ajustes = {
  stripeContactEmail: null,
  stripeAccountId: null,
  stripeChargesEnabled: false,
  stripePayoutsEnabled: false,
  modalidadesCobroB2b: ["AL_FINAL"],
};

describe("Ajustes → Pagos", () => {
  it("mayoreo (Dueño): muestra las modalidades de cobro, sin «no aplica» y sin Stripe", async () => {
    sesion = { token: "t", user: { rol: "DUENO", tenant: { tipoStorefront: "RETAIL_B2B" } } };
    fetchTenantSettings.mockResolvedValue(ajustes);
    render(<Pagos />);
    expect(await screen.findByText("Modalidades de cobro")).toBeTruthy();
    expect(screen.queryByText(/no aplica a negocios de mayoreo/)).toBeNull();
    expect(screen.queryByText(/Stripe/)).toBeNull();
  });

  it("menudeo (Dueño): sigue mostrando la conexión de Stripe, sin modalidades", async () => {
    sesion = { token: "t", user: { rol: "DUENO", tenant: { tipoStorefront: "RETAIL_B2C" } } };
    fetchTenantSettings.mockResolvedValue(ajustes);
    render(<Pagos />);
    expect(await screen.findByText(/Cobros con tarjeta \(Stripe\)/)).toBeTruthy();
    expect(screen.queryByText("Modalidades de cobro")).toBeNull();
  });

  it("quien no es Dueño no ve nada editable y no se pide la configuración", () => {
    sesion = { token: "t", user: { rol: "GERENTE", tenant: { tipoStorefront: "RETAIL_B2B" } } };
    render(<Pagos />);
    expect(screen.getByText(/exclusiva del Admin|no tiene acceso/)).toBeTruthy();
    expect(fetchTenantSettings).not.toHaveBeenCalled();
  });
});
