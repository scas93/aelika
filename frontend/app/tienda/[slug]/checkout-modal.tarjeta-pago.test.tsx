import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import type { PublicOrder } from "@/lib/api";

// TarjetaPagoForm renders <PaymentElement /> and calls useStripe()/
// useElements() from @stripe/react-stripe-js — mocked entirely so tests never
// touch real Stripe.js/network. confirmPayment is the only piece each test
// actually controls.
const confirmPayment = vi.fn();
vi.mock("@stripe/react-stripe-js", () => ({
  useStripe: () => ({ confirmPayment }),
  useElements: () => ({}),
  Elements: ({ children }: { children: React.ReactNode }) => children,
  PaymentElement: () => <div data-testid="payment-element" />,
}));

// fetchPublicEstadoPago is the only thing under test here — every other
// export of lib/api.ts is left real (they're plain fetch wrappers never
// invoked by TarjetaPagoForm, so there's nothing to fake).
const fetchPublicEstadoPago = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchPublicEstadoPago };
});

// Imported after the mocks above so the module picks them up.
const { TarjetaPagoForm } = await import("./checkout-modal");

const POLL_INTERVAL_MS = 2000;
const MAX_ESPERA_MS = 18000;

function buildOrder(overrides: Partial<PublicOrder> = {}): PublicOrder {
  return {
    id: "order-1",
    folio: "42",
    clienteNombre: "Cliente de prueba",
    clienteTelefono: "5555555555",
    clienteCorreo: null,
    notas: null,
    horaRecogidaTipo: "HORA_ESPECIFICA",
    horaRecogida: "18:00",
    metodoPago: "TARJETA",
    estadoPago: "PENDIENTE",
    clientSecret: "pi_test_secret",
    stripeRefundId: null,
    metodoEntrega: "RECOGER",
    puntoEnvioId: null,
    direccionCalle: null,
    direccionNumero: null,
    direccionColonia: null,
    direccionReferencias: null,
    requiereFactura: false,
    facturaRazonSocial: null,
    facturaRfc: null,
    facturaRegimenFiscal: null,
    facturaUsoCfdi: null,
    facturaCodigoPostal: null,
    facturaCorreo: null,
    estadoPedido: "PENDIENTE_CONFIRMACION",
    descuentoTotal: "0",
    notasDescuento: null,
    total: "180",
    items: [],
    ...overrides,
  };
}

async function renderYPagar(onPagado: () => void) {
  const order = buildOrder();
  render(<TarjetaPagoForm slug="tienda-test" order={order} total={180} onAtras={vi.fn()} onPagado={onPagado} />);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Pagar/ }));
    // deja resolver la promesa de confirmPayment (mockResolvedValue) antes de seguir
    await Promise.resolve();
    await Promise.resolve();
  });

  return order;
}

beforeEach(() => {
  vi.useFakeTimers();
  confirmPayment.mockReset();
  fetchPublicEstadoPago.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("TarjetaPagoForm — espera de confirmación del backend", () => {
  it('Stripe "processing" + backend nunca confirma -> mensaje de fallo, mismo folio, permite reintentar', async () => {
    confirmPayment.mockResolvedValue({ paymentIntent: { status: "processing" } });
    fetchPublicEstadoPago.mockResolvedValue({ estadoPago: "PROCESANDO" });
    const onPagado = vi.fn();

    const order = await renderYPagar(onPagado);

    expect(screen.getByText("Confirmando tu pago...")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_ESPERA_MS);
    });

    expect(screen.getByText("No pudimos confirmar tu pago a tiempo — intenta de nuevo")).toBeInTheDocument();
    // Vuelve al formulario (no a la pantalla de éxito) — mismo pedido/folio.
    expect(screen.getByText(new RegExp(`#${order.folio}`))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pagar/ })).not.toBeDisabled();
    expect(onPagado).not.toHaveBeenCalled();

    // Se agotaron exactamente floor(MAX_ESPERA/POLL) intentos (uno por cada
    // intervalo de 2s hasta cumplir los 18s), ni uno más.
    expect(fetchPublicEstadoPago).toHaveBeenCalledTimes(MAX_ESPERA_MS / POLL_INTERVAL_MS);
    expect(fetchPublicEstadoPago).toHaveBeenCalledWith("tienda-test", order.id);
  });

  it('Stripe "processing" + backend confirma FALLIDO antes del timeout -> mismo mensaje de fallo, disparado por el polling', async () => {
    confirmPayment.mockResolvedValue({ paymentIntent: { status: "processing" } });
    fetchPublicEstadoPago
      .mockResolvedValueOnce({ estadoPago: "PROCESANDO" })
      .mockResolvedValueOnce({ estadoPago: "FALLIDO" });
    const onPagado = vi.fn();

    const order = await renderYPagar(onPagado);

    await act(async () => {
      // Dos intervalos: el primero sigue esperando, el segundo ya trae FALLIDO.
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    });

    expect(screen.getByText("El pago no se pudo confirmar — intenta de nuevo")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`#${order.folio}`))).toBeInTheDocument();
    expect(onPagado).not.toHaveBeenCalled();
    expect(fetchPublicEstadoPago).toHaveBeenCalledTimes(2);
  });

  it('Stripe "succeeded" + backend nunca confirma -> pantalla de éxito de todas formas (confía en Stripe, no en el backend)', async () => {
    confirmPayment.mockResolvedValue({ paymentIntent: { status: "succeeded" } });
    fetchPublicEstadoPago.mockResolvedValue({ estadoPago: "PENDIENTE" });
    const onPagado = vi.fn();

    await renderYPagar(onPagado);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_ESPERA_MS);
    });

    expect(onPagado).toHaveBeenCalledTimes(1);
    // Nunca debe mostrarse el mensaje de fallo para este caso — sería falso
    // y empujaría a un posible doble cobro si el cliente reintenta.
    expect(screen.queryByText(/intenta de nuevo/)).not.toBeInTheDocument();
  });

  it('Stripe "succeeded" + backend confirma PAGADO antes del timeout -> éxito disparado por el polling', async () => {
    confirmPayment.mockResolvedValue({ paymentIntent: { status: "succeeded" } });
    fetchPublicEstadoPago.mockResolvedValueOnce({ estadoPago: "PENDIENTE" }).mockResolvedValueOnce({ estadoPago: "PAGADO" });
    const onPagado = vi.fn();

    await renderYPagar(onPagado);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    });

    expect(onPagado).toHaveBeenCalledTimes(1);
    expect(fetchPublicEstadoPago).toHaveBeenCalledTimes(2);
  });

  it("deja de hacer polling en cuanto se resuelve (éxito o fallo) — sin llamadas ni timers colgados después", async () => {
    confirmPayment.mockResolvedValue({ paymentIntent: { status: "processing" } });
    fetchPublicEstadoPago.mockResolvedValueOnce({ estadoPago: "PROCESANDO" }).mockResolvedValueOnce({ estadoPago: "FALLIDO" });
    const onPagado = vi.fn();

    await renderYPagar(onPagado);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    });

    expect(fetchPublicEstadoPago).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);

    // Avanzar mucho más tiempo no debe generar ninguna llamada adicional.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_ESPERA_MS * 2);
    });
    expect(fetchPublicEstadoPago).toHaveBeenCalledTimes(2);
  });

  it("rechazo síncrono de Stripe (confirmError) nunca entra a la espera — camino excluyente del polling", async () => {
    confirmPayment.mockResolvedValue({ error: { message: "Tu tarjeta fue rechazada" } });
    const onPagado = vi.fn();

    const order = await renderYPagar(onPagado);

    expect(screen.getByText("Tu tarjeta fue rechazada")).toBeInTheDocument();
    expect(screen.queryByText("Confirmando tu pago...")).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(`#${order.folio}`))).toBeInTheDocument();
    expect(fetchPublicEstadoPago).not.toHaveBeenCalled();
    expect(onPagado).not.toHaveBeenCalled();
  });
});
