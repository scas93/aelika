import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/x" }));
const { default: Barra } = await import("./BarraFiltros");

// jsdom no maqueta: se simula el desborde — cada botón «cuesta» 100 px y el ancho disponible se fija por prueba.
let disponible = 10_000;
const original = { sw: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth"), cw: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth") };
function simular() {
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.className.includes("flex-nowrap")) return 0;
      return [...this.querySelectorAll("button")].filter((b) => !b.closest("[role=menu]")).length * 100;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.className.includes("flex-nowrap") ? disponible : 0;
    },
  });
}
afterEach(() => {
  cleanup();
  disponible = 10_000;
  if (original.sw) Object.defineProperty(HTMLElement.prototype, "scrollWidth", original.sw);
  if (original.cw) Object.defineProperty(HTMLElement.prototype, "clientWidth", original.cw);
});

const base = () => (
  <Barra
    placeholder="Buscar…"
    onBuscar={() => {}}
    filtros={[{ key: "a", label: "Estado", valueLabel: null, onClear: () => {}, render: () => <span>x</span> }]}
    acciones={[
      { key: "exportar", label: "Exportar Excel", icon: <i />, tipo: "exportar", onClick: () => {} },
      { key: "imprimir", label: "Imprimir todo", icon: <i />, onClick: () => {} },
    ]}
    crear={{ label: "Nuevo pedido", onClick: () => {} }}
  />
);

describe("barra de controles", () => {
  it("con espacio: todo con texto y sin «⋯»", () => {
    simular();
    render(base());
    expect(screen.getByRole("button", { name: "Filtros" }).textContent).toContain("Filtros");
    expect(screen.getByRole("button", { name: "Nuevo pedido" }).textContent).toBe("Nuevo pedido");
    expect(screen.getByRole("button", { name: "Imprimir todo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Más acciones" })).toBeNull();
  });

  it("poco espacio: primero ícono, luego las acciones secundarias al «⋯»; crear y buscador siguen visibles", () => {
    simular();
    disponible = 350; // no caben los 4 botones; sí 3
    render(base());
    // Filtros y crear ya sin texto; Imprimir todo y exportar dentro del menú
    expect(screen.getByRole("button", { name: "Filtros" }).textContent).not.toContain("Filtros");
    expect(screen.getByRole("button", { name: "Nuevo pedido" }).textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Exportar Excel" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    expect(screen.getByRole("menuitem", { name: "Imprimir todo" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Exportar Excel" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Buscar…")).toBeTruthy();
  });

  it("espacio mínimo: Filtros también va al «⋯»", () => {
    simular();
    disponible = 0;
    render(base());
    expect(screen.queryByRole("button", { name: "Filtros" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    expect(screen.getByRole("menuitem", { name: "Filtros" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nuevo pedido" })).toBeTruthy();
  });
});
