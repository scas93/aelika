import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CalendarioPortal, DiaCalendarioPortal, SemanaCalendarioPortal } from "@/lib/portal-api";
import PasoDias from "./paso-dias";

// Un día que el negocio marcó sin entrega se ve como «Sin entrega» (con su nota) y no se puede elegir en el portal.

afterEach(cleanup);

const DIAS = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO"];

function semana(sinEntrega: Record<number, string | null>): SemanaCalendarioPortal {
  const base = new Date("2026-12-21T00:00:00Z");
  const dias: DiaCalendarioPortal[] = DIAS.map((d, i) => {
    const f = new Date(base);
    f.setUTCDate(base.getUTCDate() + i);
    const bloqueado = i in sinEntrega;
    return {
      fecha: f.toISOString().slice(0, 10),
      diaSemana: d,
      entregaAt: `${f.toISOString().slice(0, 10)}T14:00:00.000Z`,
      estado: bloqueado ? "NO_DISPONIBLE" : "AGREGABLE",
      motivo: bloqueado ? "SIN_ENTREGA" : null,
      limiteAt: null,
      accion: bloqueado ? null : "CREAR_PEDIDO",
      entrega: null,
      sinEntrega: bloqueado ? { nota: sinEntrega[i] } : null,
    };
  });
  return {
    semanaInicio: "2026-12-21",
    semanaFin: "2026-12-27",
    esActual: false,
    pedido: null,
    puedeCrear: true,
    dias,
  };
}

const calendario = (s: SemanaCalendarioPortal): CalendarioPortal => ({
  ahora: "2026-12-15T16:00:00.000Z",
  zonaHoraria: "America/Mexico_City",
  horaEntrega: "08:00",
  horasAgregar: 36,
  horasModificar: 18,
  horizonteSemanas: 1,
  numeroAtencion: "3331006915",
  cliente: { id: "c1", nombre: "Cafe Entredos" },
  pedidosActivos: 0,
  maximoActivos: 2,
  semanas: [s],
});

describe("Portal · crear pedido · días sin entrega", () => {
  it("el día sin entrega se ve «Sin entrega · nota», no se puede elegir y no ofrece contactar al negocio", () => {
    const onToggle = vi.fn();
    const s = semana({ 4: "Navidad" }); // viernes 25-dic
    render(
      <PasoDias cliente="Cafe Entredos" calendario={calendario(s)} semana={s} fechas={[]} onToggle={onToggle} onContinuar={vi.fn()} />,
    );
    expect(screen.getByText("Sin entrega · Navidad")).toBeTruthy();
    const filaFestivo = screen.getByText("Sin entrega · Navidad").closest("button")!;
    expect((filaFestivo as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(filaFestivo);
    expect(onToggle).not.toHaveBeenCalled();
    // Los demás días siguen disponibles.
    const habilitados = screen.getAllByRole("checkbox").filter((b) => !(b as HTMLButtonElement).disabled);
    expect(habilitados).toHaveLength(6);
    // Un festivo no es un día "cerrado" para el que tenga sentido escribirle al negocio.
    expect(screen.queryByText(/WhatsApp|Escríbenos/i)).toBeNull();
  });

  it("sin nota solo dice «Sin entrega»", () => {
    const s = semana({ 3: null });
    render(
      <PasoDias cliente="Cafe Entredos" calendario={calendario(s)} semana={s} fechas={[]} onToggle={vi.fn()} onContinuar={vi.fn()} />,
    );
    expect(screen.getByText("Sin entrega")).toBeTruthy();
  });
});
