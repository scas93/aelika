import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/session-context", () => ({ useSession: () => ({ token: "t", user: { rol: "GERENTE", tenant: { slug: "banetto" } } }) }));
const createClienteB2b = vi.fn();
const fetchClientesB2bConfig = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, createClienteB2b, fetchClientesB2bConfig };
});
const { default: Alta } = await import("./cliente-b2b-form");

beforeEach(() => {
  fetchClientesB2bConfig.mockResolvedValue({ modalidadesActivas: ["AL_FINAL", "AL_INICIO"] });
});

afterEach(() => {
  cleanup();
  createClienteB2b.mockReset();
  fetchClientesB2bConfig.mockReset();
});

describe("alta de cliente B2B", () => {
  it("sin código; «Crear cliente» siempre activo; con datos faltantes marca los campos y no envía", async () => {
    render(<Alta open onClose={() => {}} onCreado={() => {}} />);
    expect(screen.queryByText(/Código del cliente/)).toBeNull();
    expect(screen.getByText("Principal")).toBeTruthy();
    expect(await screen.findByRole("option", { name: "Elige una modalidad" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Igual que el negocio/ })).toBeNull();
    const crear = screen.getByRole("button", { name: "Crear cliente" }) as HTMLButtonElement;
    expect(crear.disabled).toBe(false);
    fireEvent.click(crear);
    expect(await screen.findByText("Escribe el nombre comercial.")).toBeTruthy();
    expect(screen.getByText("Escribe la dirección.")).toBeTruthy();
    expect(screen.getByText("Agrega al menos un teléfono.")).toBeTruthy();
    expect(screen.getByText("Elige una modalidad de pago.")).toBeTruthy();
    expect(createClienteB2b).not.toHaveBeenCalled();
  });

  function llenarDatos() {
    fireEvent.change(screen.getByPlaceholderText("Ej. Café Aurora Matriz"), { target: { value: "Café Aurora" } });
    fireEvent.change(screen.getByPlaceholderText("Calle, número, colonia, ciudad"), { target: { value: "Av. Uno 123" } });
    fireEvent.change(screen.getByLabelText("Teléfono 1"), { target: { value: "5511112222" } });
  }

  it("con dos modalidades activas no hay selección por defecto: sin elegir no se envía", async () => {
    render(<Alta open onClose={() => {}} onCreado={() => {}} />);
    await screen.findByRole("option", { name: "Pago por adelantado" });
    expect((screen.getByLabelText("Modalidad de pago") as HTMLSelectElement).value).toBe("");
    llenarDatos();
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));
    expect(await screen.findByText("Elige una modalidad de pago.")).toBeTruthy();
    expect(createClienteB2b).not.toHaveBeenCalled();
  });

  it("con una sola modalidad activa se selecciona sola y la otra queda deshabilitada con el aviso", async () => {
    fetchClientesB2bConfig.mockResolvedValue({ modalidadesActivas: ["AL_FINAL"] });
    createClienteB2b.mockResolvedValue({ id: "c1" });
    const onCreado = vi.fn();
    render(<Alta open onClose={() => {}} onCreado={onCreado} />);
    await waitFor(() => expect((screen.getByLabelText("Modalidad de pago") as HTMLSelectElement).value).toBe("AL_FINAL"));
    const inactiva = screen.getByRole("option", { name: "Pago por adelantado — Actívala en Ajustes → Pagos" }) as HTMLOptionElement;
    expect(inactiva.disabled).toBe(true);
    llenarDatos();
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));
    await waitFor(() => expect(onCreado).toHaveBeenCalled());
    expect(createClienteB2b.mock.calls[0][1]).toMatchObject({ modalidadPago: "AL_FINAL" });
  });

  it("con todo correcto envía sin sufijo", async () => {
    createClienteB2b.mockResolvedValue({ id: "c1" });
    const onCreado = vi.fn();
    render(<Alta open onClose={() => {}} onCreado={onCreado} />);
    await screen.findByRole("option", { name: "Pago por adelantado" });
    llenarDatos();
    fireEvent.change(screen.getByLabelText("Modalidad de pago"), { target: { value: "AL_INICIO" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear cliente" }));
    await waitFor(() => expect(onCreado).toHaveBeenCalled());
    expect(createClienteB2b.mock.calls[0][1]).not.toHaveProperty("sufijo");
    expect(createClienteB2b.mock.calls[0][1]).toMatchObject({ nombre: "Café Aurora", direccion: "Av. Uno 123", modalidadPago: "AL_INICIO" });
  });
});
