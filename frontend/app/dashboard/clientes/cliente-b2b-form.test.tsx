import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/session-context", () => ({ useSession: () => ({ token: "t", user: { rol: "GERENTE", tenant: { slug: "banetto" } } }) }));
const createClienteB2b = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, createClienteB2b, fetchClientesB2bConfig: vi.fn().mockResolvedValue({ modalidadCobroNegocio: "AL_FINAL" }) };
});
const { default: Alta } = await import("./cliente-b2b-form");

afterEach(() => {
  cleanup();
  createClienteB2b.mockReset();
});

describe("alta de cliente B2B", () => {
  it("sin código; «Crear cliente» siempre activo; con datos faltantes marca los campos y no envía", async () => {
    render(<Alta open onClose={() => {}} onCreado={() => {}} />);
    expect(screen.queryByText(/Código del cliente/)).toBeNull();
    expect(screen.getByText("Principal")).toBeTruthy();
    expect(await screen.findByRole("option", { name: "Igual que el negocio (Al final)" })).toBeTruthy();
    const crear = screen.getByRole("button", { name: "Crear cliente" }) as HTMLButtonElement;
    expect(crear.disabled).toBe(false);
    fireEvent.click(crear);
    expect(await screen.findByText("Escribe el nombre comercial.")).toBeTruthy();
    expect(screen.getByText("Escribe la dirección.")).toBeTruthy();
    expect(screen.getByText("Agrega al menos un teléfono.")).toBeTruthy();
    expect(createClienteB2b).not.toHaveBeenCalled();
  });

  it("con todo correcto envía sin sufijo", async () => {
    createClienteB2b.mockResolvedValue({ id: "c1" });
    const onCreado = vi.fn();
    render(<Alta open onClose={() => {}} onCreado={onCreado} />);
    fireEvent.change(screen.getByPlaceholderText("Ej. Café Aurora Matriz"), { target: { value: "Café Aurora" } });
    fireEvent.change(screen.getByPlaceholderText("Calle, número, colonia, ciudad"), { target: { value: "Av. Uno 123" } });
    fireEvent.change(screen.getByLabelText("Teléfono 1"), { target: { value: "5511112222" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));
    await waitFor(() => expect(onCreado).toHaveBeenCalled());
    expect(createClienteB2b.mock.calls[0][1]).not.toHaveProperty("sufijo");
    expect(createClienteB2b.mock.calls[0][1]).toMatchObject({ nombre: "Café Aurora", direccion: "Av. Uno 123" });
  });
});
