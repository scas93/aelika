import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const updateTenantSettings = vi.fn();
const fetchUsoModalidadesCobro = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, updateTenantSettings, fetchUsoModalidadesCobro };
});
const { default: Seccion } = await import("./modalidades-cobro-section");

afterEach(() => {
  cleanup();
  updateTenantSettings.mockReset();
  fetchUsoModalidadesCobro.mockReset();
});

const credito = () => screen.getByRole("checkbox", { name: /A crédito/ }) as HTMLInputElement;
const adelantado = () => screen.getByRole("checkbox", { name: /Pago por adelantado/ }) as HTMLInputElement;
const guardar = () => screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement;

describe("Ajustes → Pagos · Modalidades de cobro (mayoreo)", () => {
  it("muestra las dos modalidades con su explicación y el estado actual", () => {
    render(<Seccion token="t" activas={["AL_FINAL"]} onUpdated={() => {}} />);
    expect(credito().checked).toBe(true);
    expect(adelantado().checked).toBe(false);
    expect(screen.getByText(/se cobra después, por fuera de Aelika/)).toBeTruthy();
    expect(screen.getByText(/se confirma cuando registras el pago/)).toBeTruthy();
    expect(guardar().disabled).toBe(true); // sin cambios
  });

  it("no deja guardar con ninguna modalidad activa", () => {
    render(<Seccion token="t" activas={["AL_FINAL"]} onUpdated={() => {}} />);
    fireEvent.click(credito());
    expect(screen.getByText("Debe quedar activa al menos una modalidad.")).toBeTruthy();
    expect(guardar().disabled).toBe(true);
    expect(updateTenantSettings).not.toHaveBeenCalled();
  });

  it("activar una más guarda sin pedir confirmación", async () => {
    updateTenantSettings.mockResolvedValue({ modalidadesCobroB2b: ["AL_FINAL", "AL_INICIO"] });
    const onUpdated = vi.fn();
    render(<Seccion token="t" activas={["AL_FINAL"]} onUpdated={onUpdated} />);
    fireEvent.click(adelantado());
    fireEvent.click(guardar());
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(["AL_FINAL", "AL_INICIO"]));
    expect(updateTenantSettings.mock.calls[0][1]).toEqual({ modalidadesCobroB2b: ["AL_FINAL", "AL_INICIO"] });
    expect(fetchUsoModalidadesCobro).not.toHaveBeenCalled();
  });

  it("desactivar una modalidad en uso avisa cuántos clientes la tienen y pide confirmación antes de guardar", async () => {
    fetchUsoModalidadesCobro.mockResolvedValue({ AL_FINAL: 3, AL_INICIO: 0 });
    updateTenantSettings.mockResolvedValue({ modalidadesCobroB2b: ["AL_INICIO"] });
    render(<Seccion token="t" activas={["AL_FINAL", "AL_INICIO"]} onUpdated={() => {}} />);
    fireEvent.click(credito());
    fireEvent.click(guardar());
    expect(await screen.findByText(/3 clientes usan «A crédito»/)).toBeTruthy();
    expect(updateTenantSettings).not.toHaveBeenCalled(); // aún no se guardó
    fireEvent.click(screen.getByRole("button", { name: "Desactivar" }));
    await waitFor(() => expect(updateTenantSettings).toHaveBeenCalled());
    expect(updateTenantSettings.mock.calls[0][1]).toEqual({ modalidadesCobroB2b: ["AL_INICIO"] });
  });

  it("desactivar una modalidad sin clientes guarda directo", async () => {
    fetchUsoModalidadesCobro.mockResolvedValue({ AL_FINAL: 0, AL_INICIO: 0 });
    updateTenantSettings.mockResolvedValue({ modalidadesCobroB2b: ["AL_INICIO"] });
    render(<Seccion token="t" activas={["AL_FINAL", "AL_INICIO"]} onUpdated={() => {}} />);
    fireEvent.click(credito());
    fireEvent.click(guardar());
    await waitFor(() => expect(updateTenantSettings).toHaveBeenCalled());
    expect(screen.queryByText(/clientes usan/)).toBeNull();
  });
});
