import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { ClienteInscritoLealtad } from "@/lib/api";

const logout = vi.fn();
vi.mock("@/lib/session-context", () => ({
  useSession: () => ({ logout }),
}));

const fetchClientesInscritosLealtad = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchClientesInscritosLealtad };
});

// Importados después de los mocks de arriba para que los tomen.
const { ApiError } = await import("@/lib/api");
const { formatFechaCorta } = await import("@/lib/format");
const { default: ClientesInscritosTab } = await import("./clientes-inscritos-tab");

function fila(p: Partial<ClienteInscritoLealtad> & { id: string; nombre: string }): ClienteInscritoLealtad {
  return {
    telefono: "3311112222",
    contador: 0,
    estado: "EN_PROGRESO",
    ultimoSelloAt: null,
    inscritoAt: "2026-09-01T18:00:00.000Z",
    ...p,
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("ClientesInscritosTab", () => {
  it("muestra las filas en el orden que manda el backend, con indicador de premio y 'Sin sellos'", async () => {
    fetchClientesInscritosLealtad.mockResolvedValue([
      fila({ id: "1", nombre: "Ana Torres", contador: 10, estado: "PREMIO_DISPONIBLE", ultimoSelloAt: "2026-03-02T18:00:00.000Z" }),
      fila({ id: "2", nombre: "Carlos Ramírez", contador: 4, ultimoSelloAt: "2026-09-27T18:00:00.000Z" }),
      fila({ id: "3", nombre: "Lucía Fernández", contador: 0 }),
    ]);
    render(<ClientesInscritosTab token="jwt" />);

    const filas = (await screen.findAllByRole("row")).slice(1); // sin el encabezado
    expect(filas.map((f) => within(f).getAllByRole("cell")[0].textContent)).toEqual([
      "Ana Torres",
      "Carlos Ramírez",
      "Lucía Fernández",
    ]);

    expect(within(filas[0]).getByText("10/10")).toBeInTheDocument();
    expect(within(filas[0]).getByText("Premio pendiente")).toBeInTheDocument();
    expect(within(filas[1]).queryByText("Premio pendiente")).not.toBeInTheDocument();
    expect(within(filas[2]).getByText("0/10")).toBeInTheDocument();
    expect(within(filas[2]).getByText("Sin sellos")).toBeInTheDocument();
    expect(within(filas[1]).getByText("33 1111 2222")).toBeInTheDocument();
    expect(screen.getByText("3 clientes inscritos")).toBeInTheDocument();
  });

  it("estado vacío cuando el tenant no tiene inscritos", async () => {
    fetchClientesInscritosLealtad.mockResolvedValue([]);
    render(<ClientesInscritosTab token="jwt" />);
    expect(
      await screen.findByText("Aún no hay clientes inscritos — regístralos en la pestaña Registrar nuevo cliente."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("401 se trata como sesión expirada", async () => {
    fetchClientesInscritosLealtad.mockRejectedValue(new ApiError("Unauthorized", 401));
    render(<ClientesInscritosTab token="jwt" />);
    await vi.waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });

  it("otro error muestra el mensaje del backend", async () => {
    fetchClientesInscritosLealtad.mockRejectedValue(new ApiError("Algo falló", 500));
    render(<ClientesInscritosTab token="jwt" />);
    expect(await screen.findByText("Algo falló")).toBeInTheDocument();
  });
});

describe("formatFechaCorta", () => {
  const ahora = new Date("2026-09-28T18:00:00.000Z");

  it("sin año si es del año en curso, con año si no lo es", () => {
    expect(formatFechaCorta("2026-09-28T18:00:00.000Z", ahora)).toMatch(/^28 sept?\.?$/);
    expect(formatFechaCorta("2025-08-14T18:00:00.000Z", ahora)).toMatch(/^14 ago\.? 2025$/);
  });

  it("usa el día de Ciudad de México, no el de UTC", () => {
    // 29-sep 04:30 UTC = 28-sep 22:30 en CDMX.
    expect(formatFechaCorta("2026-09-29T04:30:00.000Z", ahora)).toMatch(/^28 sept?\.?$/);
    // 1-ene-2026 05:00 UTC = 31-dic-2025 23:00 en CDMX → otro año, lleva año.
    expect(formatFechaCorta("2026-01-01T05:00:00.000Z", ahora)).toMatch(/^31 dic\.? 2025$/);
  });
});
