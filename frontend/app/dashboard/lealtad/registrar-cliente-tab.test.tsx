import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { LealtadRespuesta } from "@/lib/api";

vi.mock("qrcode.react", () => ({ QRCodeSVG: () => <svg data-testid="qr" /> }));

const altaClienteLealtad = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, altaClienteLealtad };
});

const { default: RegistrarClienteTab } = await import("./registrar-cliente-tab");

const LINK = "https://pass.walletwallet.dev/p/serial-1";

function respuesta(pase: LealtadRespuesta["pase"]): LealtadRespuesta {
  return {
    loyaltyCard: {
      id: "card-1",
      tenantId: "t-1",
      clienteId: "c-1",
      token: "tok",
      contador: 0,
      estado: "EN_PROGRESO",
      serialNumber: "serial-1",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    pase,
  };
}

async function registrar() {
  render(<RegistrarClienteTab token="jwt" slug="pizzeria-demo" />);
  fireEvent.change(screen.getByPlaceholderText("Nombre del cliente"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByPlaceholderText("10 dígitos"), { target: { value: "5550000301" } });
  fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
  await waitFor(() => expect(screen.getByText("Cliente registrado")).toBeTruthy());
}

describe("RegistrarClienteTab — link de la tarjeta", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    altaClienteLealtad.mockReset();
    writeText.mockReset();
    Object.assign(navigator, { clipboard: { writeText } });
  });
  afterEach(cleanup);

  it("muestra el link y «Copiar» copia ese link", async () => {
    altaClienteLealtad.mockResolvedValue(respuesta({ serialNumber: "serial-1", shareUrl: LINK }));
    await registrar();

    expect(screen.getByText(LINK)).toBeTruthy();
    const copiar = screen.getAllByRole("button", { name: "Copiar" });
    fireEvent.click(copiar[copiar.length - 1]);
    expect(writeText).toHaveBeenCalledWith(LINK);
  });

  it("un pase sin shareUrl no deja la caja vacía ni copia undefined: muestra un error claro", async () => {
    altaClienteLealtad.mockResolvedValue(respuesta({ serialNumber: "serial-1", lastUpdated: 1, unchanged: true } as never));
    await registrar();

    expect(screen.getByText(/no recibimos el link de la tarjeta/i)).toBeTruthy();
    expect(screen.queryByText("Link para agregar la tarjeta al wallet")).toBeNull();
    // Solo queda el «Copiar» del link de auto-registro (el de la tarjeta no se muestra).
    expect(screen.getAllByRole("button", { name: "Copiar" })).toHaveLength(1);
  });

  it("pase null también muestra el error claro", async () => {
    altaClienteLealtad.mockResolvedValue(respuesta(null));
    await registrar();

    expect(screen.getByText(/no recibimos el link de la tarjeta/i)).toBeTruthy();
  });
});
