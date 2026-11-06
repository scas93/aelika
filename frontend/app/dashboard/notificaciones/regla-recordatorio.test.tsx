import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { CatalogoVariableDef, CreateReglaPayload, ReglaMensajeCategoria } from "@/lib/api";

let tipo = "RETAIL_B2B";
vi.mock("@/lib/session-context", () => ({
  useSession: () => ({ user: { rol: "DUENO", tenant: { tipoStorefront: tipo } }, token: "t" }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard/notificaciones/seguimiento/nueva" }));

const catalogo: CatalogoVariableDef[] = [
  { fuente: "CAMPO_CLIENTE", valor: "nombre", grupo: "CLIENTE", label: "Nombre", ejemplo: "Ana López", restriccion: { tipo: "ninguna" }, fallback: "—" },
  { fuente: "SEMANA_SIGUIENTE", valor: "inicio", grupo: "SEMANA", label: "Semana siguiente: inicio (lunes)", ejemplo: "9 de noviembre", restriccion: { tipo: "semana", motivo: "Solo en el recordatorio semanal de pedido (mayoreo)" }, fallback: "—" },
  { fuente: "SEMANA_SIGUIENTE", valor: "fin", grupo: "SEMANA", label: "Semana siguiente: fin (domingo)", ejemplo: "15 de noviembre", restriccion: { tipo: "semana", motivo: "Solo en el recordatorio semanal de pedido (mayoreo)" }, fallback: "—" },
];
const fetchCatalogoVariables = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchCatalogoVariables };
});

const { default: ReglaForm } = await import("./regla-form");

function montar(categoria: ReglaMensajeCategoria = "UTILITY", onSubmit: (p: CreateReglaPayload) => Promise<void> = async () => {}) {
  return render(<ReglaForm categoriaFija={categoria} onSubmit={onSubmit} onCancel={() => {}} />);
}
const opciones = () => Array.from(screen.getByLabelText(/Cuándo se dispara/).querySelectorAll("option")).map((o) => o.textContent);

beforeEach(() => {
  tipo = "RETAIL_B2B";
  fetchCatalogoVariables.mockReset().mockResolvedValue(catalogo);
});
afterEach(cleanup);

describe("Notificaciones · recordatorio semanal de pedido (formulario)", () => {
  it("mayoreo desde Seguimiento (Utility) lo ofrece", async () => {
    montar("UTILITY");
    await waitFor(() => expect(fetchCatalogoVariables).toHaveBeenCalled());
    expect(opciones()).toContain("Recordatorio semanal de pedido");
  });

  it.each([
    ["RETAIL_B2C", "UTILITY"],
    ["HOTEL", "UTILITY"],
    ["RETAIL_B2B", "MARKETING"],
  ] as const)("%s / %s: no se ofrece", async (t, categoria) => {
    tipo = t;
    montar(categoria);
    await waitFor(() => expect(fetchCatalogoVariables).toHaveBeenCalled());
    expect(opciones()).not.toContain("Recordatorio semanal de pedido");
  });

  it("explica qué hace, pide día y hora y manda día, hora, variables y botón al guardar (sin filtro)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    montar("UTILITY", onSubmit);
    await screen.findByText(/Nombre de la regla/);
    fireEvent.change(screen.getByLabelText(/Cuándo se dispara/), { target: { value: "RECORDATORIO_SEMANAL_PEDIDO" } });

    expect(screen.getByText(/Recuerda por WhatsApp a tus clientes/)).toBeTruthy();
    expect(screen.getByText(/nunca al día siguiente/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Día de la semana/), { target: { value: "sabado" } });
    fireEvent.change(screen.getByLabelText(/Hora \(en punto, CDMX\)/), { target: { value: "11" } });

    fireEvent.change(screen.getByLabelText(/Nombre de la regla/), { target: { value: "Recordatorio sábado" } });
    fireEvent.change(screen.getByLabelText(/Nombre de la plantilla/), { target: { value: "recordatorio_pedido" } });
    fireEvent.change(screen.getByLabelText(/Botón de URL dinámica/), { target: { value: "panaderia-banetto" } });

    // Tres variables: nombre del cliente, inicio y fin de la semana.
    for (const clave of ["CAMPO_CLIENTE::nombre", "SEMANA_SIGUIENTE::inicio", "SEMANA_SIGUIENTE::fin"]) {
      fireEvent.click(screen.getByText("+ Agregar variable"));
      const selects = screen.getAllByRole("combobox").filter((el) => el.querySelector("option[value='VALOR_FIJO']"));
      fireEvent.change(selects[selects.length - 1], { target: { value: clave } });
    }

    fireEvent.click(screen.getByText("Crear regla"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      trigger: "RECORDATORIO_SEMANAL_PEDIDO",
      triggerConfig: { diaSemana: "sabado", hora: 11 },
      filtro: [],
      plantillaCategoria: "UTILITY",
      plantillaNombre: "recordatorio_pedido",
      botonUrlValor: "panaderia-banetto",
      plantillaVariables: [
        { posicion: 1, fuente: "CAMPO_CLIENTE", valor: "nombre" },
        { posicion: 2, fuente: "SEMANA_SIGUIENTE", valor: "inicio" },
        { posicion: 3, fuente: "SEMANA_SIGUIENTE", valor: "fin" },
      ],
    });
  });

  it("las variables de semana no se pueden elegir en otros tipos de regla", async () => {
    montar("UTILITY");
    await screen.findByText(/Nombre de la regla/);
    fireEvent.change(screen.getByLabelText(/Cuándo se dispara/), { target: { value: "MANUAL" } });
    fireEvent.click(screen.getByText("+ Agregar variable"));
    const inicio = screen.getByText(/Semana siguiente: inicio/) as HTMLOptionElement;
    expect(inicio.disabled).toBe(true);
  });

  it("un tipo distinto no manda botonUrlValor (no toca el de una regla existente)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    montar("UTILITY", onSubmit);
    await screen.findByText(/Nombre de la regla/);
    fireEvent.change(screen.getByLabelText(/Nombre de la regla/), { target: { value: "Manual" } });
    fireEvent.change(screen.getByLabelText(/Cuándo se dispara/), { target: { value: "MANUAL" } });
    fireEvent.change(screen.getByLabelText(/Nombre de la plantilla/), { target: { value: "x" } });
    fireEvent.click(screen.getByText("Crear regla"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(Object.keys(onSubmit.mock.calls[0][0])).not.toContain("botonUrlValor");
  });
});
