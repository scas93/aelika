import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/x" }));
const { default: Popover } = await import("./Popover");

// jsdom no maqueta: el trigger «mide» lo que diga `trigger` y el panel (fijo) 314 px de ancho; la ventana 1440.
let trigger = { left: 1300, right: 1400, top: 40, bottom: 80 };
const props = { sw: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"), rect: HTMLElement.prototype.getBoundingClientRect };
beforeEach(() => {
  trigger = { left: 1300, right: 1400, top: 40, bottom: 80 };
  Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1440 });
  Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.style.position === "fixed" ? 314 : 0;
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return this.className.includes("relative") ? ({ ...trigger, width: trigger.right - trigger.left, height: 40, x: trigger.left, y: trigger.top, toJSON() {} } as DOMRect) : props.rect.call(this);
  };
});
afterEach(() => {
  cleanup();
  if (props.sw) Object.defineProperty(HTMLElement.prototype, "offsetWidth", props.sw);
  HTMLElement.prototype.getBoundingClientRect = props.rect;
});

function Caja({ abierto, onClose = () => {} }: { abierto: boolean; onClose?: () => void }) {
  return (
    <Popover open={abierto} onClose={onClose} trigger={<button>abrir</button>}>
      <div>contenido</div>
    </Popover>
  );
}
const panel = () => screen.getByText("contenido").parentElement as HTMLElement;

describe("Popover", () => {
  it("el panel va en un portal fijo (fuera del trigger): no cuenta como desborde de ningún contenedor", () => {
    const { container } = render(<Caja abierto />);
    expect(container.contains(panel())).toBe(false);
    expect(panel().parentElement).toBe(document.body);
    expect(panel().style.position).toBe("fixed");
  });

  it("siempre queda dentro de la ventana, en cada apertura repetida (sin alternar de lado entre aperturas)", () => {
    const vistas: number[] = [];
    const { rerender } = render(<Caja abierto={false} />);
    for (let i = 0; i < 4; i++) {
      rerender(<Caja abierto />);
      const left = parseFloat(panel().style.left);
      expect(left).toBeGreaterThanOrEqual(8);
      expect(left + 314).toBeLessThanOrEqual(1440 - 8);
      vistas.push(left);
      rerender(<Caja abierto={false} />);
    }
    // Trigger cerca del borde derecho: alineado a su borde derecho (1400 − 314), igual las cuatro veces.
    expect(new Set(vistas)).toEqual(new Set([1086]));
  });

  it("con espacio a la derecha se alinea al borde izquierdo del trigger", () => {
    trigger = { left: 400, right: 500, top: 40, bottom: 80 };
    render(<Caja abierto />);
    expect(parseFloat(panel().style.left)).toBe(400);
  });

  it("abierto no salta de lado aunque el trigger se mueva (p. ej. le aparece el contador a «Filtros»); sí lo sigue", () => {
    trigger = { left: 1122, right: 1220, top: 40, bottom: 80 }; // 1122 + 314 > 1432 → derecha
    const { rerender } = render(<Caja abierto />);
    expect(parseFloat(panel().style.left)).toBe(1220 - 314);
    trigger = { left: 1100, right: 1220, top: 40, bottom: 80 }; // ahora «cabría» a la izquierda, pero no debe cambiar de lado
    rerender(<Caja abierto />);
    expect(parseFloat(panel().style.left)).toBe(1220 - 314);
  });

  it("nunca se sale por la izquierda de la ventana", () => {
    trigger = { left: 20, right: 60, top: 40, bottom: 80 };
    document.documentElement.style.width = "";
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 340 });
    render(<Caja abierto />);
    expect(parseFloat(panel().style.left)).toBe(8);
  });

  it("no se cierra al montarse; se cierra con Escape y con clic fuera, no con clic dentro", () => {
    const onClose = vi.fn();
    render(<Caja abierto onClose={onClose} />);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByText("contenido"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
