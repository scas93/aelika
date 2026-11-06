import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/session-context", () => ({ useSession: () => ({ token: "t", user: { rol: "GERENTE", tenant: { slug: "banetto" } } }) }));
vi.mock("./historial-pedidos-cliente", () => ({ default: () => null }));
const fetchClienteB2b = vi.fn();
const fetchClientesB2bConfig = vi.fn();
const updateClienteB2b = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchClienteB2b, fetchClientesB2bConfig, updateClienteB2b };
});
const { default: Panel } = await import("./cliente-b2b-panel");

const cliente = (extra = {}) => ({
  id: "c1",
  codigo: "banetto-aurora",
  nombre: "Café Aurora",
  direccion: "Av. Uno 123",
  descuentoPorcentaje: null,
  modalidadPago: "AL_INICIO",
  modalidadInactiva: false,
  activo: true,
  bajaAt: null,
  pedidosActivos: 0,
  incompleto: false,
  resumenSemanalActivo: false,
  resumenSemanalCorreo: null,
  totalPedidos: 0,
  ultimoPedidoAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  telefonos: [{ id: "t1", telefono: "5511112222", principal: true, nombreContacto: null }],
  ...extra,
});

afterEach(() => {
  cleanup();
  fetchClienteB2b.mockReset();
  fetchClientesB2bConfig.mockReset();
});

describe("ficha del cliente B2B · modalidad de pago", () => {
  it("modalidad inactiva: avisa en la ficha, la conserva seleccionada y las inactivas salen deshabilitadas", async () => {
    fetchClientesB2bConfig.mockResolvedValue({ modalidadesActivas: ["AL_FINAL"] });
    fetchClienteB2b.mockResolvedValue(cliente({ modalidadInactiva: true }));
    render(<Panel clienteId="c1" onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText(/Esta modalidad ya no está activa en Ajustes → Pagos/)).toBeTruthy();
    const select = (await screen.findByLabelText("Modalidad de pago")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("AL_INICIO"));
    expect((screen.getByRole("option", { name: /Pago por adelantado/ }) as HTMLOptionElement).disabled).toBe(true);
    expect((screen.getByRole("option", { name: "A crédito" }) as HTMLOptionElement).disabled).toBe(false);
    expect(screen.queryByRole("option", { name: /Igual que el negocio/ })).toBeNull();
  });

  it("modalidad activa: sin aviso", async () => {
    fetchClientesB2bConfig.mockResolvedValue({ modalidadesActivas: ["AL_FINAL", "AL_INICIO"] });
    fetchClienteB2b.mockResolvedValue(cliente());
    render(<Panel clienteId="c1" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByLabelText("Modalidad de pago");
    expect(screen.queryByText(/ya no está activa/)).toBeNull();
  });
});

describe("ficha del cliente B2B · resumen semanal por correo", () => {
  it("apagado y sin correo: el interruptor no se puede encender hasta capturar un correo; el heredado no se prellena", async () => {
    fetchClientesB2bConfig.mockResolvedValue({ modalidadesActivas: ["AL_FINAL"] });
    fetchClienteB2b.mockResolvedValue(cliente());
    render(<Panel clienteId="c1" onClose={() => {}} onChanged={() => {}} />);
    const interruptor = await screen.findByRole("switch", { name: /Encender el resumen semanal/ });
    const correo = screen.getByLabelText("Correo del resumen") as HTMLInputElement;
    expect(correo.value).toBe("");
    fireEvent.click(interruptor);
    expect(interruptor.getAttribute("aria-checked")).toBe("false");
    fireEvent.change(correo, { target: { value: "compras@aurora.com" } });
    fireEvent.click(interruptor);
    expect(interruptor.getAttribute("aria-checked")).toBe("true");
  });

  it("guardar manda el correo y el interruptor; borrar el correo apaga el interruptor", async () => {
    fetchClientesB2bConfig.mockResolvedValue({ modalidadesActivas: ["AL_FINAL"] });
    fetchClienteB2b.mockResolvedValue(cliente({ resumenSemanalActivo: true, resumenSemanalCorreo: "a@b.com" }));
    updateClienteB2b.mockResolvedValue(cliente({ resumenSemanalActivo: false, resumenSemanalCorreo: null }));
    render(<Panel clienteId="c1" onClose={() => {}} onChanged={() => {}} />);
    const correo = (await screen.findByLabelText("Correo del resumen")) as HTMLInputElement;
    await waitFor(() => expect(correo.value).toBe("a@b.com"));
    fireEvent.change(correo, { target: { value: "" } });
    expect(screen.getByRole("switch", { name: /resumen semanal de este cliente/ }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(updateClienteB2b).toHaveBeenCalled());
    expect(updateClienteB2b.mock.calls[0][2]).toMatchObject({ resumenSemanalCorreo: null, resumenSemanalActivo: false });
  });
});
