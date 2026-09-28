import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { LealtadRespuesta, LoyaltyCard } from "@/lib/api";

// La cámara real (@zxing/browser + getUserMedia) no existe en jsdom — el
// scanner se reemplaza por un doble que expone botones para simular "leyó
// un QR" y "no se pudo abrir la cámara". Que el doble esté montado o no es
// exactamente lo que importa: montado = cámara encendida.
vi.mock("./qr-scanner", () => ({
  default: ({ onScan, onError }: { onScan: (t: string) => void; onError: (m: string) => void }) => (
    <div data-testid="qr-scanner">
      <button onClick={() => onScan("qr-token-1")}>simular-scan</button>
      <button onClick={() => onError("Se negó el permiso para usar la cámara.")}>simular-error-camara</button>
    </div>
  ),
}));

const logout = vi.fn();
vi.mock("@/lib/session-context", () => ({
  useSession: () => ({ logout }),
}));

const registrarCompraLealtad = vi.fn();
const redimirPremioLealtad = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, registrarCompraLealtad, redimirPremioLealtad };
});

// Importados después de los mocks de arriba para que los tomen.
const { ApiError } = await import("@/lib/api");
const { default: RegistrarCompraTab } = await import("./registrar-compra-tab");

function card(overrides: Partial<LoyaltyCard> = {}): LoyaltyCard {
  return {
    id: "card-1",
    tenantId: "tenant-1",
    clienteId: "cliente-1",
    token: "qr-token-1",
    contador: 3,
    estado: "EN_PROGRESO",
    serialNumber: "serial-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function respuesta(overrides: Partial<LoyaltyCard> = {}): LealtadRespuesta {
  return { loyaltyCard: card(overrides), pase: null };
}

async function escanear() {
  fireEvent.click(screen.getByRole("button", { name: "Escanear tarjeta" }));
  fireEvent.click(screen.getByRole("button", { name: "simular-scan" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("RegistrarCompraTab", () => {
  it("abre con la cámara apagada y solo la enciende al tocar Escanear tarjeta", () => {
    render(<RegistrarCompraTab token="jwt" />);
    expect(screen.queryByTestId("qr-scanner")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Escanear tarjeta" }));
    expect(screen.getByTestId("qr-scanner")).toBeInTheDocument();
  });

  it("Cancelar apaga la cámara y regresa al estado inicial", () => {
    render(<RegistrarCompraTab token="jwt" />);
    fireEvent.click(screen.getByRole("button", { name: "Escanear tarjeta" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByTestId("qr-scanner")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escanear tarjeta" })).toBeInTheDocument();
  });

  it("registra el sello y 'Escanear otro' no reenciende la cámara", async () => {
    registrarCompraLealtad.mockResolvedValue(respuesta({ contador: 4 }));
    render(<RegistrarCompraTab token="jwt" />);
    await escanear();

    expect(await screen.findByText("Sello registrado")).toBeInTheDocument();
    expect(screen.getByText("Sellos: 4/10")).toBeInTheDocument();
    expect(registrarCompraLealtad).toHaveBeenCalledWith("jwt", "qr-token-1");
    expect(screen.queryByTestId("qr-scanner")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Escanear otro" }));
    expect(screen.queryByTestId("qr-scanner")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escanear tarjeta" })).toBeInTheDocument();
  });

  it("sello #10: permite canjear o volver sin canjear", async () => {
    registrarCompraLealtad.mockResolvedValue(respuesta({ contador: 10, estado: "PREMIO_DISPONIBLE" }));
    redimirPremioLealtad.mockResolvedValue(respuesta({ contador: 0 }));
    render(<RegistrarCompraTab token="jwt" />);
    await escanear();

    expect(await screen.findByText(/Premio disponible/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Marcar premio entregado" }));
    expect(await screen.findByText("Premio entregado")).toBeInTheDocument();
    expect(redimirPremioLealtad).toHaveBeenCalledWith("jwt", "qr-token-1");
  });

  it("premio pendiente (código PREMIO_PENDIENTE): 'Volver sin canjear' regresa al inicio", async () => {
    registrarCompraLealtad.mockRejectedValue(new ApiError("premio", 409, "PREMIO_PENDIENTE"));
    render(<RegistrarCompraTab token="jwt" />);
    await escanear();

    expect(await screen.findByText("Esta tarjeta ya tiene un premio pendiente")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar premio entregado" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Volver sin canjear" }));
    expect(screen.getByRole("button", { name: "Escanear tarjeta" })).toBeInTheDocument();
    expect(redimirPremioLealtad).not.toHaveBeenCalled();
  });

  it("ya hay sello hoy y token no encontrado se distinguen por código", async () => {
    registrarCompraLealtad.mockRejectedValueOnce(new ApiError("hoy", 409, "SELLO_YA_REGISTRADO_HOY"));
    render(<RegistrarCompraTab token="jwt" />);
    await escanear();
    expect(await screen.findByText(/ya registró un sello el día de hoy/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Escanear otro" }));
    registrarCompraLealtad.mockRejectedValueOnce(new ApiError("nada", 404, "TOKEN_NO_ENCONTRADO"));
    await escanear();
    expect(await screen.findByText("No se encontró ninguna tarjeta con ese código.")).toBeInTheDocument();
  });

  it("401 se trata como sesión expirada (logout)", async () => {
    registrarCompraLealtad.mockRejectedValue(new ApiError("Unauthorized", 401));
    render(<RegistrarCompraTab token="jwt" />);
    await escanear();
    await vi.waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });

  it("un error sin código (ej. 400) se muestra como genérico con el mensaje del backend", async () => {
    registrarCompraLealtad.mockRejectedValue(new ApiError("token must be a string", 400));
    render(<RegistrarCompraTab token="jwt" />);
    await escanear();

    expect(await screen.findByText("token must be a string")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Volver al inicio" }));
    expect(screen.queryByTestId("qr-scanner")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Escanear tarjeta" })).toBeInTheDocument();
  });

  it("si la cámara falla muestra el motivo y deja reintentar desde el botón", () => {
    render(<RegistrarCompraTab token="jwt" />);
    fireEvent.click(screen.getByRole("button", { name: "Escanear tarjeta" }));
    fireEvent.click(screen.getByRole("button", { name: "simular-error-camara" }));

    expect(screen.queryByTestId("qr-scanner")).not.toBeInTheDocument();
    expect(screen.getByText("Se negó el permiso para usar la cámara.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(screen.getByTestId("qr-scanner")).toBeInTheDocument();
  });
});
