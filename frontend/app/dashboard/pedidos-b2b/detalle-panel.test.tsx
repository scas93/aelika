import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { PedidoB2bDetalle } from "@/lib/api";

let rol = "GERENTE";
vi.mock("@/lib/session-context", () => ({ useSession: () => ({ user: { rol }, token: "t" }) }));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

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
    clienteId: "c1",
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
  await screen.findByText("Semana del 19 oct");
}

describe("DetallePanel (pedido B2B)", () => {
  beforeEach(() => {
    rol = "GERENTE";
    fetchPedidoB2b.mockReset();
    push.mockReset();
  });
  afterEach(cleanup);

  it("encabezado: «Semana del 19 oct» con el badge de estado; sin folio ni datos del cliente arriba", async () => {
    await abrir(pedido());
    expect(screen.getByText("Semana del 19 oct")).toBeTruthy();
    expect(screen.getByText("Por confirmar")).toBeTruthy();
    expect(screen.queryByText(/P-000001/)).toBeNull();
    // El badge de estado va debajo del título, no flotando junto a la X
    const titulo = screen.getByText("Semana del 19 oct");
    expect(titulo.nextElementSibling?.textContent).toBe("Por confirmar");
    // Los datos del cliente salen una sola vez, en la sección «Cliente» (debajo de Entregas)
    expect(screen.getAllByText("Café Aurora")).toHaveLength(1);
    expect(screen.getAllByText(/5511112222/)).toHaveLength(1);
  });

  it("tarjeta de montos: subtotal, descuento y total UNA sola vez; pago solo con el estado (sin modo de cobro)", async () => {
    await abrir(pedido());
    expect(screen.getAllByText("$135.00")).toHaveLength(1);
    expect(screen.getByText("$150.00")).toBeTruthy();
    expect(screen.getByText("-$15.00")).toBeTruthy();
    expect(screen.getByText("Descuento (10%)")).toBeTruthy();
    expect(screen.queryByText(/Al final|Al inicio/)).toBeNull();
    expect(screen.queryByText("Resumen por producto")).toBeNull();
    expect(screen.getByRole("button", { name: "Marcar pagado" })).toBeTruthy();
  });

  it("sin descuento solo se muestra el Total (sin línea de Subtotal)", async () => {
    await abrir(pedido({ descuentoTotal: "0", subtotal: "150", total: "150" }));
    expect(screen.queryByText("Subtotal")).toBeNull();
    expect(screen.queryByText(/Descuento/)).toBeNull();
    expect(screen.getAllByText("$150.00").length).toBeGreaterThan(0);
    expect(screen.getByText("Total")).toBeTruthy();
  });

  it("sección Cliente: nombre, contacto, teléfono y correo; «Ver cliente» lleva al cliente (Gerente/Dueño)", async () => {
    await abrir(pedido({ contactoCorreo: "mariana@aurora.test" }));
    // Una tarjeta: negocio y, debajo, «contacto · teléfono · correo»
    expect(screen.getByText("Mariana · 5511112222 · mariana@aurora.test")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver cliente" }));
    expect(push).toHaveBeenCalledWith("/dashboard/clientes?cliente=c1");
  });

  it("el Operador ve la sección Cliente sin el botón «Ver cliente»", async () => {
    rol = "OPERADOR";
    await abrir(pedido());
    expect(screen.getByText("Mariana · 5511112222")).toBeTruthy(); // sin correo, sin separador sobrante
    expect(screen.queryByRole("button", { name: "Ver cliente" })).toBeNull();
  });

  it("Operador no ve Marcar pagado, Confirmar ni Cancelar, pero sí Editar pedido y cerrar entregas", async () => {
    rol = "OPERADOR";
    await abrir(pedido({ estado: "CONFIRMADO_SURTIENDO" }));
    expect(screen.queryByRole("button", { name: "Marcar pagado" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar pedido" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
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
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  });

  it("Por confirmar: «Editar pedido», Confirmar (principal) y Cancelar; la primera entrega pendiente abierta", async () => {
    await abrir(pedido());
    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirmar pedido" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancelar pedido" })).toBeTruthy();
    // Entrega del lunes abierta ($100), la del miércoles plegada
    const filas = screen.getAllByRole("button", { expanded: true });
    expect(filas).toHaveLength(1);
    expect(filas[0].textContent).toContain("Lun 19 oct");
    // El encabezado de la entrega no lleva piezas ni monto; los productos con su importe salen al abrirla.
    expect(filas[0].textContent).not.toMatch(/piezas|\$/);
    expect(screen.getByText("Pan × 10")).toBeTruthy();
    expect(screen.getByText("$100.00")).toBeTruthy();
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
    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirmar pedido" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancelar pedido" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Entregada" })).toHaveLength(1);
  });

  it("Completado: sin pie, con «Editar pedido» (Históricos); todas cerradas → todas plegadas", async () => {
    const p = pedido({ estado: "COMPLETADO" });
    p.entregas!.forEach((e) => (e.estado = "ENTREGADA"));
    await abrir(p);
    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar pedido" })).toBeNull();
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
  });

  it("Cancelado: aviso con original y a cobrar, entregas canceladas en gris, sin pie", async () => {
    const p = pedido({ cancelado: true, canceladoAt: "2026-10-20T18:00:00.000Z", subtotal: "100", descuentoTotal: "10", total: "90" });
    p.entregas![1].estado = "CANCELADA";
    p.entregas![0].estado = "ENTREGADA";
    await abrir(p);
    expect(screen.getByRole("alert").textContent).toMatch(/^Cancelado el /);
    expect(screen.getByRole("alert").textContent).not.toMatch(/\$/);
    expect(screen.getByText("Pedido original")).toBeTruthy();
    expect(screen.getByText("$150.00", { selector: "span" })).toBeTruthy();
    expect(screen.getAllByText("$90.00")).toHaveLength(1); // total a cobrar, una sola vez
    expect(screen.getByText("Total a cobrar")).toBeTruthy();
    expect(screen.getAllByText("Cancelada").length).toBe(1);
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar pedido" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Marcar pagado" })).toBeTruthy(); // A cobrar $90 > 0
  });

  it("Cancelado con A cobrar $0: sin «Marcar pagado»", async () => {
    const p = pedido({ cancelado: true, canceladoAt: "2026-10-20T18:00:00.000Z", subtotal: "0", descuentoTotal: "0", total: "0" });
    p.entregas!.forEach((e) => (e.estado = "CANCELADA"));
    await abrir(p);
    expect(screen.queryByRole("button", { name: "Marcar pagado" })).toBeNull();
  });

  it("al abrir una entrega se ven sus productos con el importe de la línea", async () => {
    await abrir(pedido());
    fireEvent.click(screen.getAllByRole("button", { expanded: false })[0]); // entrega del miércoles
    expect(screen.getAllByText("Pan × 5").length).toBe(1);
    expect(screen.getByText("$50.00")).toBeTruthy();
  });

  it("caso del 19 oct: pedido de la semana del 19 con entregas Mié 21 y Jue 22 → abierta la del miércoles", async () => {
    const p = pedido();
    p.entregas = [
      { id: "e2", fecha: "2026-10-21T00:00:00.000Z", dia: "MIERCOLES", estado: "PENDIENTE", cerradaAt: null, atrasada: false },
      { id: "e3", fecha: "2026-10-22T00:00:00.000Z", dia: "JUEVES", estado: "PENDIENTE", cerradaAt: null, atrasada: false },
    ];
    await abrir(p);
    const filas = screen.getAllByRole("button", { expanded: true });
    expect(filas).toHaveLength(1);
    expect(filas[0].textContent).toContain("Mié 21 oct");
  });

  it("al cambiar de pedido sin cerrar el panel, la entrega abierta se vuelve a calcular (no arrastra lo plegado del anterior)", async () => {
    const a = pedido();
    fetchPedidoB2b.mockResolvedValue(a);
    const { rerender } = render(<DetallePanel pedidoId="p1" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText("Semana del 19 oct");
    fireEvent.click(screen.getAllByRole("button", { expanded: true })[0]); // pliega la abierta del primero
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
    const b = pedido({ id: "p2" });
    fetchPedidoB2b.mockResolvedValue(b);
    rerender(<DetallePanel pedidoId="p2" onClose={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1));
  });
});
