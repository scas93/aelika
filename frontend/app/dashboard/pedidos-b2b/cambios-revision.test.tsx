import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { PedidoB2bCambiosRespuesta, PedidoB2bDetalle } from "@/lib/api";

let rol = "GERENTE";
vi.mock("@/lib/session-context", () => ({ useSession: () => ({ user: { rol }, token: "t" }) }));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const fetchPedidoB2b = vi.fn();
const fetchCambiosPedidoB2b = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchPedidoB2b, fetchCambiosPedidoB2b, fetchProducts: vi.fn().mockResolvedValue([]) };
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
      {
        id: "i2",
        productId: "prod2",
        nombreProducto: "Concha",
        precioUnitario: "20",
        cantidadTotal: 4,
        distribucion: [{ id: "d3", dia: "LUNES", cantidad: 4 }],
      },
    ],
    entregas: [
      { id: "e1", fecha: "2026-10-19T00:00:00.000Z", dia: "LUNES", estado: "PENDIENTE", cerradaAt: null, atrasada: false },
      { id: "e2", fecha: "2026-10-21T00:00:00.000Z", dia: "MIERCOLES", estado: "PENDIENTE", cerradaAt: null, atrasada: false },
    ],
    ...extra,
  } as PedidoB2bDetalle;
}

async function abrir(p: PedidoB2bDetalle, cambios: PedidoB2bCambiosRespuesta | null = null) {
  fetchPedidoB2b.mockResolvedValue(p);
  fetchCambiosPedidoB2b.mockResolvedValue(cambios);
  render(<DetallePanel pedidoId="p1" onClose={() => {}} onChanged={() => {}} />);
  await screen.findByText("Semana del 19 oct");
}

const MARCA = { modificadoPorClienteAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T10:00:00.000Z" };

const conCambios: PedidoB2bCambiosRespuesta = {
  estado: "CON_CAMBIOS",
  cambios: {
    nota: null,
    total: { antes: "135.00", despues: "160.00" },
    soloPrecios: false,
    sinDiferencias: false,
    entregas: [
      {
        tipo: "MODIFICADA",
        fecha: "2026-10-19",
        piezas: 14,
        lineas: [
          { productId: "prod1", nombreProducto: "Pan", tipo: "CAMBIO", antes: 8, despues: 10 },
          { productId: "prod2", nombreProducto: "Concha", tipo: "NUEVO", antes: null, despues: 4 },
          { productId: "prod9", nombreProducto: "Rol de Canela", tipo: "ELIMINADO", antes: 2, despues: null },
        ],
      },
      { tipo: "NUEVA", fecha: "2026-10-21", piezas: 5, lineas: [{ productId: "prod1", nombreProducto: "Pan", tipo: "NUEVO", antes: null, despues: 5 }] },
      { tipo: "ELIMINADA", fecha: "2026-10-23", piezas: 3, lineas: [{ productId: "prod1", nombreProducto: "Pan", tipo: "ELIMINADO", antes: 3, despues: null }] },
    ],
  },
};

describe("DetallePanel · cambios desde la última revisión", () => {
  beforeEach(() => {
    rol = "GERENTE";
    fetchPedidoB2b.mockReset();
    fetchCambiosPedidoB2b.mockReset();
  });
  afterEach(cleanup);

  it("con la marca prendida: sección bajo el aviso, con la lista de cambios", async () => {
    await abrir(pedido(MARCA), conCambios);
    const titulo = await screen.findByText("Cambios desde la última revisión");
    expect(fetchCambiosPedidoB2b).toHaveBeenCalledWith("t", "p1");
    const aviso = screen.getByText(/Modificado por el cliente desde el portal/);
    expect(aviso.compareDocumentPosition(titulo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Lun 19 oct · Pan: 8 → 10 piezas")).toBeTruthy();
    expect(screen.getByText("Lun 19 oct · Concha: nuevo (4)")).toBeTruthy();
    expect(screen.getByText("Lun 19 oct · Rol de Canela: eliminado")).toBeTruthy();
    expect(screen.getByText("Entrega nueva: mié 21 oct (5 piezas)")).toBeTruthy();
    expect(screen.getByText("Entrega eliminada: vie 23 oct")).toBeTruthy();
    expect(screen.getByText("Total: $135.00 → $160.00")).toBeTruthy();
  });

  it("marca las líneas y entregas afectadas en la lista de entregas (nuevo, cambió, eliminado tachado, entrega nueva y eliminada)", async () => {
    await abrir(pedido(MARCA), conCambios);
    await screen.findByText("Cambios desde la última revisión");
    expect(screen.getByText("Cambió 8 → 10")).toBeTruthy();
    expect(screen.getByText("Nuevo")).toBeTruthy();
    const eliminado = screen.getByText(/Rol de Canela × 2/);
    expect(eliminado.className).toContain("line-through");
    expect(screen.getByText("Nueva")).toBeTruthy();
    expect(screen.getByText("Eliminada")).toBeTruthy();
    expect(screen.getByText("Vie 23 oct").className).toContain("line-through");
  });

  it("marca anterior a la referencia: aviso con el texto de «sin detalle»", async () => {
    await abrir(pedido(MARCA), { estado: "SIN_DETALLE", cambios: null });
    expect(await screen.findByText(/No hay detalle de esta modificación/)).toBeTruthy();
    expect(screen.queryByText("Cambió 8 → 10")).toBeNull();
  });

  it("varias ediciones que dejaron el pedido igual: «Sin diferencias frente a la última revisión»", async () => {
    await abrir(pedido(MARCA), { estado: "SIN_DIFERENCIAS", cambios: null });
    expect(await screen.findByText("Sin diferencias frente a la última revisión")).toBeTruthy();
  });

  it("solo cambió el total por precios: lo dice, sin cambios de productos", async () => {
    await abrir(pedido(MARCA), {
      estado: "CON_CAMBIOS",
      cambios: { entregas: [], nota: null, soloPrecios: true, sinDiferencias: false, total: { antes: "135.00", despues: "140.00" } },
    });
    expect(await screen.findByText("El total cambió por actualización de precios ($135.00 → $140.00)")).toBeTruthy();
    expect(screen.queryByText(/Cambió \d/)).toBeNull();
  });

  it("sin marca o con el pedido cancelado: no hay sección y ni siquiera se consulta", async () => {
    await abrir(pedido(), conCambios);
    expect(screen.queryByText("Cambios desde la última revisión")).toBeNull();
    cleanup();
    await abrir(pedido({ ...MARCA, cancelado: true, canceladoAt: "2026-10-21T10:00:00.000Z" }), conCambios);
    expect(screen.queryByText("Cambios desde la última revisión")).toBeNull();
    expect(fetchCambiosPedidoB2b).not.toHaveBeenCalled();
  });

  it("el Operador y el Admin también la ven (los 3 roles abren el pedido)", async () => {
    for (const r of ["OPERADOR", "DUENO"]) {
      rol = r;
      await abrir(pedido(MARCA), conCambios);
      expect(await screen.findByText("Cambios desde la última revisión")).toBeTruthy();
      cleanup();
    }
  });

  it("si la lectura de los cambios falla, el aviso de siempre sigue y no aparece la sección", async () => {
    fetchPedidoB2b.mockResolvedValue(pedido(MARCA));
    fetchCambiosPedidoB2b.mockRejectedValue(new Error("x"));
    render(<DetallePanel pedidoId="p1" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText("Semana del 19 oct");
    await waitFor(() => expect(fetchCambiosPedidoB2b).toHaveBeenCalled());
    expect(screen.getByText(/Modificado por el cliente desde el portal/)).toBeTruthy();
    expect(screen.queryByText("Cambios desde la última revisión")).toBeNull();
  });
});
