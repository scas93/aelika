import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { NotificacionCanalConfig, NotificacionEventoConfig } from "@/lib/api";

const fetchResumenClientesConfig = vi.fn();
const guardarResumenClientesConfig = vi.fn();
const fetchClientesB2bSelector = vi.fn();
const createNotificacionCanal = vi.fn();
const createNotificacionEvento = vi.fn();
const updateNotificacionEvento = vi.fn();
const enviarResumenClientePrueba = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchResumenClientesConfig, guardarResumenClientesConfig, fetchClientesB2bSelector, createNotificacionCanal, createNotificacionEvento, updateNotificacionEvento, enviarResumenClientePrueba };
});
const { default: Card } = await import("./resumen-clientes-card");

const canal: NotificacionCanalConfig = { id: "m1", tenantId: "x", tipo: "CORREO", activo: false, conectado: false, config: { nombreRemitente: "Banetto", correos: [] } };
const evento = (activo: boolean): NotificacionEventoConfig => ({ id: "e1", tenantId: "x", evento: "RESUMEN_SEMANAL", audiencia: "CLIENTE", canalConfigId: "m1", activo, canalConfig: canal });

beforeEach(() => {
  [fetchResumenClientesConfig, guardarResumenClientesConfig, fetchClientesB2bSelector, createNotificacionCanal, createNotificacionEvento, updateNotificacionEvento, enviarResumenClientePrueba].forEach((f) => f.mockReset());
  fetchResumenClientesConfig.mockResolvedValue({ correoRespuestas: null });
  fetchClientesB2bSelector.mockResolvedValue([{ id: "c1", nombre: "Café Aurora", codigo: "b-a", descuentoPorcentaje: null }]);
});
afterEach(cleanup);

const montar = (canales: NotificacionCanalConfig[], eventos: NotificacionEventoConfig[], onChange = vi.fn().mockResolvedValue(undefined)) =>
  render(<Card token="t" nombreNegocio="Banetto" canales={canales} eventos={eventos} onChange={onChange} />);

describe("Resumen semanal para clientes (Ajustes → Notificaciones)", () => {
  it("apagado por defecto; la primera vez crea el canal Correo INACTIVO y el evento, y lo enciende", async () => {
    createNotificacionCanal.mockResolvedValue(canal);
    createNotificacionEvento.mockResolvedValue(evento(false));
    updateNotificacionEvento.mockResolvedValue(evento(true));
    montar([], []);
    expect(screen.getByText("Apagado")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /Encender el resumen semanal para clientes/ }));
    await waitFor(() => expect(updateNotificacionEvento).toHaveBeenCalledWith("t", "e1", { activo: true }));
    expect(createNotificacionCanal).toHaveBeenCalledWith("t", { tipo: "CORREO", config: { nombreRemitente: "Banetto", correos: [] }, activo: false });
    expect(createNotificacionEvento).toHaveBeenCalledWith("t", { evento: "RESUMEN_SEMANAL", audiencia: "CLIENTE", canalConfigId: "m1" });
  });

  it("con el evento existente solo lo prende o apaga", async () => {
    updateNotificacionEvento.mockResolvedValue(evento(false));
    montar([canal], [evento(true)]);
    expect(screen.getByText("Encendido")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: /Apagar el resumen semanal para clientes/ }));
    await waitFor(() => expect(updateNotificacionEvento).toHaveBeenCalledWith("t", "e1", { activo: false }));
    expect(createNotificacionCanal).not.toHaveBeenCalled();
  });

  it("guarda el correo de respuestas", async () => {
    guardarResumenClientesConfig.mockResolvedValue({ correoRespuestas: "ventas@banetto.mx" });
    montar([canal], [evento(false)]);
    const input = screen.getByLabelText(/Correo de respuestas/) as HTMLInputElement;
    await waitFor(() => expect(input.disabled).toBe(false));
    fireEvent.change(input, { target: { value: " ventas@banetto.mx " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar correo de respuestas" }));
    await waitFor(() => expect(guardarResumenClientesConfig).toHaveBeenCalledWith("t", "ventas@banetto.mx"));
  });

  it("prueba: elige cliente, semana y dirección, y manda la semana elegida", async () => {
    enviarResumenClientePrueba.mockResolvedValue({ resultado: "EXITO", motivo: null, semanaInicio: "2026-09-21", semanaFin: "2026-09-27" });
    montar([canal], [evento(true)]);
    const boton = screen.getByRole("button", { name: "Enviar prueba del cliente" }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    await screen.findByRole("option", { name: "Café Aurora" });
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "c1" } });
    const semana = screen.getByLabelText("Semana") as HTMLSelectElement;
    const segunda = semana.options[1].value;
    fireEvent.change(semana, { target: { value: segunda } });
    fireEvent.change(screen.getByLabelText("Enviar a"), { target: { value: "yo@mio.com" } });
    fireEvent.click(boton);
    await waitFor(() => expect(enviarResumenClientePrueba).toHaveBeenCalledWith("t", { clienteId: "c1", correo: "yo@mio.com", semanaInicio: segunda }));
    expect(await screen.findByText(/Prueba enviada a yo@mio.com/)).toBeTruthy();
  });
});
