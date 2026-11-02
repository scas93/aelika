import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { LealtadRespuesta } from "@/lib/api";

vi.mock("next/navigation", () => ({ useParams: () => ({ slug: "pizzeria-demo" }) }));

const fetchPublicTenant = vi.fn();
const altaClienteLealtadPublico = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchPublicTenant, altaClienteLealtadPublico };
});

const { default: LealtadPublicoPage } = await import("./page");

const LINK = "https://pass.walletwallet.dev/p/serial-1";

function respuesta(pase: LealtadRespuesta["pase"]): LealtadRespuesta {
  return { loyaltyCard: { serialNumber: "serial-1" } as never, pase };
}

async function registrar() {
  render(<LealtadPublicoPage />);
  await waitFor(() => expect(screen.getByPlaceholderText("Tu nombre")).toBeTruthy());
  fireEvent.change(screen.getByPlaceholderText("Tu nombre"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByPlaceholderText("10 dígitos"), { target: { value: "5550000301" } });
  fireEvent.click(screen.getByRole("button", { name: "Registrarme" }));
}

describe("/lealtad/[slug] — redirección al link de la tarjeta", () => {
  const original = window.location;
  let href = "";

  beforeEach(() => {
    href = "";
    fetchPublicTenant.mockResolvedValue({ nombre: "Pizzería Demo", logoUrl: null });
    altaClienteLealtadPublico.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { get href() { return href; }, set href(v: string) { href = v; } },
    });
  });
  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("redirige al link de su tarjeta", async () => {
    altaClienteLealtadPublico.mockResolvedValue(respuesta({ serialNumber: "serial-1", shareUrl: LINK }));
    await registrar();

    await waitFor(() => expect(href).toBe(LINK));
  });

  it("un pase sin shareUrl no se queda esperando: muestra un mensaje claro y no redirige", async () => {
    altaClienteLealtadPublico.mockResolvedValue(respuesta({ serialNumber: "serial-1", unchanged: true } as never));
    await registrar();

    await waitFor(() => expect(screen.getByText(/no pudimos mostrarte tu tarjeta/i)).toBeTruthy());
    expect(screen.queryByText(/Te estamos llevando/)).toBeNull();
    expect(href).toBe("");
  });

  it("pase null muestra el mismo mensaje y no redirige", async () => {
    altaClienteLealtadPublico.mockResolvedValue(respuesta(null));
    await registrar();

    await waitFor(() => expect(screen.getByText(/no pudimos mostrarte tu tarjeta/i)).toBeTruthy());
    expect(href).toBe("");
  });
});
