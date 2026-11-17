import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
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

  it("el panel de filtros abierto (y aplicar un filtro) NO cambia la barra: Filtros y exportar siguen visibles, sin «⋯», y el panel sigue abierto", () => {
    simular();
    disponible = 450; // la barra cabe (4 botones = 400); si el panel colgara de la fila, sus botones la desbordarían
    function Pantalla() {
      const [marcados, setMarcados] = useState<string[]>([]);
      return (
        <Barra
          placeholder="Buscar…"
          onBuscar={() => {}}
          filtros={[
            {
              key: "a",
              label: "Estado",
              valueLabel: marcados.length ? marcados.join(",") : null,
              onClear: () => setMarcados([]),
              render: () => (
                <div>
                  <button type="button" onClick={() => setMarcados((m) => [...m, "x"])}>marcar uno</button>
                  <button type="button" onClick={() => setMarcados((m) => [...m, "y"])}>marcar otro</button>
                </div>
              ),
            },
          ]}
          acciones={[
            { key: "exportar", label: "Exportar Excel", icon: <i />, tipo: "exportar", onClick: () => {} },
            { key: "imprimir", label: "Imprimir todo", icon: <i />, onClick: () => {} },
          ]}
          crear={{ label: "Nuevo pedido", onClick: () => {} }}
        />
      );
    }
    render(<Pantalla />);
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    fireEvent.click(screen.getByRole("button", { name: /^Estado/ }));
    const fila = document.querySelector(".flex-nowrap")!;
    // El panel vive fuera de la fila (portal): no puede contar como desborde de la barra.
    expect(fila.contains(screen.getByRole("button", { name: "marcar uno" }))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "marcar uno" }));
    fireEvent.click(screen.getByRole("button", { name: "marcar otro" }));
    expect(screen.getByRole("button", { name: "Filtros" }).textContent).toContain("Filtros"); // con texto: nivel 0
    expect(screen.getByRole("button", { name: "Exportar Excel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Más acciones" })).toBeNull();
    // Sigue abierto para marcar más opciones.
    expect(screen.getByRole("button", { name: "marcar uno" })).toBeTruthy();
  });

  it("con la barra compactada, abrir y cerrar «Filtros» desde el «⋯» varias veces abre el panel cada vez, y marcar opciones no lo cierra", () => {
    simular();
    disponible = 0;
    function Pantalla() {
      const [n, setN] = useState(0);
      return (
        <Barra
          placeholder="Buscar…"
          onBuscar={() => {}}
          filtros={[{ key: "a", label: "Estado", valueLabel: n ? String(n) : null, onClear: () => setN(0), render: () => <button type="button" onClick={() => setN(n + 1)}>marcar</button> }]}
          acciones={[{ key: "exportar", label: "Exportar Excel", icon: <i />, tipo: "exportar", onClick: () => {} }]}
        />
      );
    }
    render(<Pantalla />);
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
      fireEvent.click(screen.getByRole("menuitem", { name: /^Filtros/ }));
      fireEvent.click(screen.getByRole("button", { name: /^Estado/ }));
      fireEvent.click(screen.getByRole("button", { name: "marcar" }));
      fireEvent.click(screen.getByRole("button", { name: "marcar" }));
      expect(screen.getByRole("button", { name: "marcar" })).toBeTruthy(); // sigue abierto tras marcar
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("button", { name: "marcar" })).toBeNull();
    }
  });
});
