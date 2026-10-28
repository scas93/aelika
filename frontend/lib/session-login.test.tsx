import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/dashboard/pedidos-b2b",
}));

const fetchCurrentUser = vi.fn();
const login = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchCurrentUser, login };
});

const { SessionProvider, useSession } = await import("./session-context");
const { avisarSesionInvalida, saveSession } = await import("./session");
const { default: LoginPage } = await import("@/app/login/page");

function Salir() {
  const { logout } = useSession();
  return <button onClick={logout}>salir</button>;
}

function ubicacion(pathname: string, search: string) {
  const replaceUrl = vi.fn();
  vi.stubGlobal("location", { pathname, search, replace: replaceUrl });
  return replaceUrl;
}

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  fetchCurrentUser.mockReset();
  login.mockReset();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SessionProvider sin sesión", () => {
  it("manda a /login con la ruta y los parámetros a los que iba", async () => {
    ubicacion("/dashboard/pedidos-b2b", "?pedido=abc");
    render(<SessionProvider>x</SessionProvider>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Fdashboard%2Fpedidos-b2b%3Fpedido%3Dabc"));
  });

  it("sesión guardada pero inválida (fetchCurrentUser falla) también recuerda el destino", async () => {
    saveSession({ accessToken: "t", user: { rol: "DUENO" } } as never);
    fetchCurrentUser.mockRejectedValue(new Error("401"));
    ubicacion("/dashboard/adopcion", "?semana=2026-10-26");
    render(<SessionProvider>x</SessionProvider>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?next=%2Fdashboard%2Fadopcion%3Fsemana%3D2026-10-26"));
  });

  it("cierre de sesión voluntario va a /login a secas", async () => {
    saveSession({ accessToken: "t", user: { rol: "DUENO" } } as never);
    fetchCurrentUser.mockResolvedValue({ rol: "DUENO", tenant: { nombre: "N" } });
    ubicacion("/dashboard/pedidos-b2b", "?pedido=abc");
    render(
      <SessionProvider>
        <Salir />
      </SessionProvider>,
    );
    fireEvent.click(await screen.findByText("salir"));
    expect(push).toHaveBeenCalledWith("/login");
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("401 del API", () => {
  it("avisarSesionInvalida lleva a /login con el destino", () => {
    const r = ubicacion("/dashboard/pedidos-b2b", "?pedido=abc");
    avisarSesionInvalida();
    expect(r).toHaveBeenCalledWith("/login?next=%2Fdashboard%2Fpedidos-b2b%3Fpedido%3Dabc");
  });

  it("estando ya en /login no redirige", () => {
    const r = ubicacion("/login", "");
    avisarSesionInvalida();
    expect(r).not.toHaveBeenCalled();
  });
});

describe("LoginPage", () => {
  async function iniciar(search: string, rol = "DUENO", storefront = "RETAIL_B2B") {
    ubicacion("/login", search);
    login.mockResolvedValue({ accessToken: "t", user: { rol } });
    fetchCurrentUser.mockResolvedValue({ tenant: { tipoStorefront: storefront } });
    const { container } = render(<LoginPage />);
    fireEvent.change(container.querySelector('input[type="email"]')!, { target: { value: "a@b.com" } });
    fireEvent.change(container.querySelector('input[type="password"]')!, { target: { value: "x" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(push).toHaveBeenCalled());
    return push.mock.calls[0][0];
  }

  it("regresa a la ruta y parámetros guardados", async () => {
    expect(await iniciar("?next=%2Fdashboard%2Fpedidos-b2b%3Fpedido%3Dabc")).toBe("/dashboard/pedidos-b2b?pedido=abc");
  });

  it("entrada directa a /login va a /dashboard", async () => {
    expect(await iniciar("")).toBe("/dashboard");
  });

  it("Operador B2C: sin next conserva su destino por defecto", async () => {
    expect(await iniciar("", "OPERADOR", "RETAIL_B2C")).toBe("/dashboard/pedidos");
  });

  it.each(["?next=https%3A%2F%2Fevil.com", "?next=%2F%2Fevil.com", "?next=%2Ftienda%2Fx"])("destino inválido %s va a /dashboard", async (s) => {
    expect(await iniciar(s)).toBe("/dashboard");
  });
});
