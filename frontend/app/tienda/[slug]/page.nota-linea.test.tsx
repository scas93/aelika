import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { PublicCatalog, PublicTenantInfo } from "@/lib/api";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "demo" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const catalogo = {
  promotions: [],
  categories: [
    {
      id: "c1",
      nombre: "Bebidas",
      products: [
        {
          id: "latte",
          nombre: "Latte",
          descripcion: null,
          precio: "50",
          fotoUrl: null,
          disponible: true,
          modifierGroups: [
            { id: "g1", nombre: "Tamaño", tipoSeleccion: "UNICA", obligatorio: false, opciones: [{ id: "o1", nombre: "Grande", precioAdicional: "10" }] },
          ],
        },
        { id: "pan", nombre: "Pan", descripcion: null, precio: "20", fotoUrl: null, disponible: true, modifierGroups: [] },
      ],
    },
  ],
} as unknown as PublicCatalog;

const fetchPublicTenant = vi.fn();
const fetchPublicCatalog = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchPublicTenant, fetchPublicCatalog, fetchPublicPuntosEnvio: vi.fn().mockResolvedValue([]) };
});

const { default: TiendaPage } = await import("./page");

async function agregarLatte(nota: string, opciones: { grande?: boolean } = {}) {
  fireEvent.click((await screen.findAllByLabelText("Agregar"))[0]);
  if (opciones.grande) fireEvent.click(screen.getByRole("button", { name: /^Grande/ }));
  if (nota !== "") fireEvent.change(screen.getByPlaceholderText("Extra caliente, sin hielo…"), { target: { value: nota } });
  fireEvent.click(screen.getByRole("button", { name: /^Agregar ·/ }));
}

function lineasDelCarrito() {
  fireEvent.click(screen.getByRole("button", { name: /artículo/ }));
  const carrito = screen.getByText("Tu pedido").parentElement!.parentElement!;
  return within(carrito).getAllByRole("listitem");
}

describe("Tienda: el carrito junta líneas por producto + modificadores + nota", () => {
  beforeEach(() => {
    fetchPublicTenant.mockResolvedValue({ nombre: "Demo", tipoStorefront: "RETAIL_B2C", logoUrl: null, horarioAtencion: null, ubicacion: null, abierto: true } as unknown as PublicTenantInfo);
    fetchPublicCatalog.mockResolvedValue(catalogo);
  });
  afterEach(cleanup);

  it("misma nota (aunque con otros espacios) → una línea con la cantidad sumada", async () => {
    render(<TiendaPage />);
    await agregarLatte("Extra caliente");
    await agregarLatte("  Extra   caliente ");
    const lineas = lineasDelCarrito();
    expect(lineas).toHaveLength(1);
    expect(lineas[0].textContent).toContain("↳ Extra caliente");
    expect(lineas[0].textContent).toContain("2");
  });

  it("nota distinta (mayúsculas y minúsculas cuentan distinto) → línea aparte", async () => {
    render(<TiendaPage />);
    await agregarLatte("Extra caliente");
    await agregarLatte("extra caliente");
    await agregarLatte("Sin hielo");
    expect(lineasDelCarrito()).toHaveLength(3);
  });

  it("con nota vs sin nota → líneas distintas; sin nota dos veces → se suman", async () => {
    render(<TiendaPage />);
    await agregarLatte("");
    await agregarLatte("");
    await agregarLatte("Sin hielo");
    const lineas = lineasDelCarrito();
    expect(lineas).toHaveLength(2);
    expect(lineas.filter((l) => l.textContent!.includes("↳"))).toHaveLength(1);
  });

  it("misma nota pero distintos modificadores → líneas distintas", async () => {
    render(<TiendaPage />);
    await agregarLatte("Sin hielo");
    await agregarLatte("Sin hielo", { grande: true });
    expect(lineasDelCarrito()).toHaveLength(2);
  });
});
