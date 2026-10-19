import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { PedidoB2bDetalle } from "@/lib/api";

let rol = "GERENTE";
vi.mock("@/lib/session-context", () => ({ useSession: () => ({ user: { rol }, token: "t" }) }));

const fetchPedidoB2b = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchPedidoB2b, fetchProducts: vi.fn().mockResolvedValue([]) };
});

const { default: DetallePanel } = await import("./detalle-panel");

// Pan $10: LUNES 10 + MIERCOLES 5 = 15 pzas = $150 (subtotal). Descuento 10% → total $135.
function pedido(extra: Partial<PedidoB2bDetalle> = {}): PedidoB2bDetalle {
  return {
    id: "p1",
    folio: "P-000001",
    negocioNombre: "Café Aurora",
    contactoNombre: "Mariana",
    contactoTelefono: "5511112222",
    contactoCorreo: "",
    semanaInicio: "2026-10-19T00:00:00.000Z",
    modoCobro: "AL_FINAL",
    estado: "PENDIENTE_CONFIRMACION",
    estadoPago: "PENDIENTE",
    totalPiezas: 15,
    codigoDescuentoTexto: null,
    descuentoPorcentajeAplicado: "10",
    subtotal: "150",
    descuentoTotal: "15",
    total: "135",
    requiereFactura: false,
    facturaRazonSocial: null,
    facturaRfc: null,
    facturaRegimenFiscal: null,
    facturaUsoCfdi: null,
    facturaCodigoPostal: null,
    facturaCorreo: null,
    cancelado: false,
    canceladoAt: null,
    minimoPiezasAplicado: 0,
    items: [
      {
        id: "i1",
        productId: "prod1",
        nombreProducto: "Pan",
        precioUnitario: "10",
        cantidadTotal: 15,
        distribucion: [
          { id: "d1", dia: "LUNES", cantidad: 10 },
          { id: "d2", dia: "MIERCOLES", cantidad: 5 },
        ],
      },
    ],
    entregas: [
      { id: "e1", fecha: "2026-10-19T00:00:00.000Z", dia: "LUNES", estado: "PENDIENTE", cerradaAt: null, atrasada: false },
      { id: "e2", fecha: "2026-10-21T00:00:00.000Z", dia: "MIERCOLES", estado: "PENDIENTE", cerradaAt: null, atrasada: false },
    ],
    ...extra,
  } as PedidoB2bDetalle;
}

async function abrir(p: PedidoB2bDetalle) {
  fetchPedidoB2b.mockResolvedValue(p);
  render(<DetallePanel pedidoId="p1" onClose={() => {}} onChanged={() => {}} />);
  await screen.findByText("Café Aurora");
}

describe("DetallePanel (pedido B2B)", () => {
  beforeEach(() => {
    rol = "GERENTE";
    fetchPedidoB2b.mockReset();
  });
  afterEach(cleanup);

  it("encabezado: negocio, semana · contacto · teléfono; sin folio ni correo", async () => {
    await abrir(pedido());
    expect(screen.getByText("Semana del 19 oct · Mariana · 5511112222")).toBeTruthy();
    expect(screen.queryByText(/P-000001/)).toBeNull();
    expect(screen.queryByText("Pago")).toBeNull(); // sin la tarjeta separada de Pago
  });

  it("franja: total grande, pago y modo de cobro; Marcar pagado para admin", async () => {
    await abrir(pedido());
    expect(screen.getAllByText("$135.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/Al final/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Marcar pagado" })).toBeTruthy();
  });

  it("Operador no ve Marcar pagado, Confirmar ni Cancelar, pero sí Editar pedido y cerrar entregas", async () => {
    rol = "OPERADOR";
    await abrir(pedido({ estado: "CONFIRMADO_SURTIENDO" }));
    expect(screen.queryByRole("button", { name: "Marcar pagado" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar pedido" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
    expect(screen.getByRole("button", { name: "Editar pedido" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Entregada" })).toHaveLength(1);
  });

  it("Operador en Por confirmar: sin pie (no confirma ni cancela)", async () => {
    rol = "OPERADOR";
    await abrir(pedido());
    expect(screen.queryByRole("button", { name: "Confirmar pedido" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
  });

  it("Operador no ve Editar pedido si el pedido está Pagado", async () => {
    rol = "OPERADOR";
    await abrir(pedido({ estadoPago: "PAGADO", pagadoAt: "2026-10-20T18:00:00.000Z" }));
    expect(screen.queryByRole("button", { name: "Editar pedido" })).toBeNull();
  });

  it("el correo del contacto va como segunda línea del encabezado, solo si existe", async () => {
    await abrir(pedido({ contactoCorreo: "mariana@aurora.test" }));
    expect(screen.getByText("mariana@aurora.test")).toBeTruthy();
  });

  it("ya pagado: el botón desaparece y el badge muestra Pagado con fecha", async () => {
    await abrir(pedido({ estadoPago: "PAGADO", pagadoAt: "2026-10-20T18:00:00.000Z" }));
    expect(screen.queryByRole("button", { name: "Marcar pagado" })).toBeNull();
    expect(screen.getByText("Pagado")).toBeTruthy();
  });

  it("Por confirmar: «Editar pedido», Confirmar (principal) y Cancelar; la primera entrega pendiente abierta", async () => {
    await abrir(pedido());
    expect(screen.getByRole("button", { name: "Editar pedido" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirmar pedido" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancelar pedido" })).toBeTruthy();
    // Entrega del lunes abierta ($100), la del miércoles plegada
    const filas = screen.getAllByRole("button", { expanded: true });
    expect(filas).toHaveLength(1);
    expect(filas[0].textContent).toContain("Lun 19 oct");
    expect(filas[0].textContent).toContain("10 piezas");
    expect(filas[0].textContent).toContain("$100.00");
  });

  it("la entrega atrasada es la que queda abierta", async () => {
    const p = pedido();
    p.entregas![1].atrasada = true;
    await abrir(p);
    const filas = screen.getAllByRole("button", { expanded: true });
    expect(filas).toHaveLength(1);
    expect(filas[0].textContent).toContain("Mié 21 oct");
    expect(screen.getByText("Atrasada")).toBeTruthy();
  });

  it("Confirmado: «Editar pedido» disponible; solo Cancelar discreto; acciones de entrega dentro de la abierta", async () => {
    await abrir(pedido({ estado: "CONFIRMADO_SURTIENDO" }));
    expect(screen.getByRole("button", { name: "Editar pedido" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirmar pedido" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancelar pedido" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Entregada" })).toHaveLength(1);
  });

  it("Completado: sin pie, con «Editar pedido» (Históricos); todas cerradas → todas plegadas", async () => {
    const p = pedido({ estado: "COMPLETADO" });
    p.entregas!.forEach((e) => (e.estado = "ENTREGADA"));
    await abrir(p);
    expect(screen.getByRole("button", { name: "Editar pedido" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar pedido" })).toBeNull();
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
  });

  it("Cancelado: aviso con original y a cobrar, entregas canceladas en gris, sin pie", async () => {
    const p = pedido({ cancelado: true, canceladoAt: "2026-10-20T18:00:00.000Z", subtotal: "100", descuentoTotal: "10", total: "90" });
    p.entregas![1].estado = "CANCELADA";
    p.entregas![0].estado = "ENTREGADA";
    await abrir(p);
    expect(screen.getByRole("status").textContent).toMatch(/Pedido original \$150\.00 · A cobrar \$90\.00/);
    expect(screen.getAllByText("Cancelada").length).toBe(1);
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar pedido" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar pedido" })).toBeNull();
    expect(screen.getByRole("button", { name: "Marcar pagado" })).toBeTruthy(); // A cobrar $90 > 0
  });

  it("Cancelado con A cobrar $0: sin «Marcar pagado»", async () => {
    const p = pedido({ cancelado: true, canceladoAt: "2026-10-20T18:00:00.000Z", subtotal: "0", descuentoTotal: "0", total: "0" });
    p.entregas!.forEach((e) => (e.estado = "CANCELADA"));
    await abrir(p);
    expect(screen.queryByRole("button", { name: "Marcar pagado" })).toBeNull();
  });

  it("al abrir una entrega se ven sus productos con el importe de la línea; resumen por producto plegado por defecto", async () => {
    await abrir(pedido());
    fireEvent.click(screen.getAllByRole("button", { expanded: false })[0]); // entrega del miércoles
    expect(screen.getAllByText("Pan × 5").length).toBe(1);
    expect(screen.getByText("$50.00")).toBeTruthy();
    expect(screen.queryByText("Pan × 15")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Resumen por producto/ }));
    await waitFor(() => expect(screen.getByText("Pan × 15")).toBeTruthy());
  });
});
