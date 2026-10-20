import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { accionPeriodo, etiquetaDia, etiquetaDiaCorta, etiquetaSemana } from "./SelectorPeriodo";

vi.mock("next/navigation", () => ({ usePathname: () => "/x" }));
vi.mock("@/lib/fecha", () => ({ hoyYYYYMMDD: () => "2026-10-19" }));
const { default: SelectorPeriodo } = await import("./SelectorPeriodo");

afterEach(cleanup);

describe("etiquetas", () => {
  it("día", () => {
    expect(etiquetaDia("2026-10-19", "2026-10-19")).toBe("Hoy · lun 19 oct");
    expect(etiquetaDia("2026-10-20", "2026-10-19")).toBe("Mañana · mar 20 oct");
    expect(etiquetaDia("2026-10-18", "2026-10-19")).toBe("Ayer · dom 18 oct");
    expect(etiquetaDia("2026-10-21", "2026-10-19")).toBe("mié 21 oct");
  });
  it("semana", () => {
    expect(etiquetaSemana("2026-10-19", "2026-10-21")).toBe("Esta semana · 19–25 oct");
    expect(etiquetaSemana("2026-10-26", "2026-10-21")).toBe("Próxima semana · 26 oct–1 nov");
    expect(etiquetaSemana("2026-10-12", "2026-10-21")).toBe("Semana pasada · 12–18 oct");
    expect(etiquetaSemana("2026-11-02", "2026-10-21")).toBe("Semana del 2–8 nov");
  });
});

describe("etiquetas cortas y acción Hoy/Esta semana", () => {
  it("día corto", () => {
    expect(etiquetaDiaCorta("2026-10-19", "2026-10-19")).toBe("Hoy · 19 oct");
    expect(etiquetaDiaCorta("2026-10-21", "2026-10-19")).toBe("21 oct");
  });
  it("accionPeriodo solo fuera del periodo actual", () => {
    const f = vi.fn();
    expect(accionPeriodo("dia", "2026-10-19", f)).toBeNull();
    expect(accionPeriodo("semana", "2026-10-19", f)).toBeNull();
    accionPeriodo("dia", "2026-10-21", f)!.onClick();
    expect(f).toHaveBeenLastCalledWith("2026-10-19");
    expect(accionPeriodo("semana", "2026-10-26", f)!.label).toBe("Esta semana");
  });
  it("modo semana corto muestra solo el rango", () => {
    render(<SelectorPeriodo modo="semana" corto valor="2026-10-19" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Elegir periodo" }).textContent).toBe("19–25 oct");
  });
});

describe("SelectorPeriodo", () => {
  it("modo semana: flecha izquierda sin destino desactivada con tooltip", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SelectorPeriodo modo="semana" valor="2026-10-19" onChange={onChange} min="2026-10-19" max="2026-10-26" tooltipMin="Las semanas anteriores están en el aviso de arriba" />,
    );
    const izq = screen.getByRole("button", { name: "Semana anterior" });
    expect((izq as HTMLButtonElement).disabled).toBe(true);
    expect(izq.parentElement?.getAttribute("title")).toBe("Las semanas anteriores están en el aviso de arriba");
    fireEvent.click(screen.getByRole("button", { name: "Semana siguiente" }));
    expect(onChange).toHaveBeenCalledWith("2026-10-26");
    rerender(<SelectorPeriodo modo="semana" valor="2026-10-26" onChange={onChange} min="2026-10-19" max="2026-10-26" />);
    expect((screen.getByRole("button", { name: "Semana siguiente" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("modo día: el calendario elige un día con un clic", () => {
    const onChange = vi.fn();
    render(<SelectorPeriodo modo="dia" valor="2026-10-21" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Elegir periodo" }));
    fireEvent.click(screen.getByRole("button", { name: "2026-10-23" }));
    expect(onChange).toHaveBeenCalledWith("2026-10-23");
  });

  it("modo semana: al elegir un día se toma el lunes de su semana", () => {
    const onChange = vi.fn();
    render(<SelectorPeriodo modo="semana" valor="2026-10-19" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Elegir periodo" }));
    fireEvent.click(screen.getByRole("button", { name: "2026-10-29" }));
    expect(onChange).toHaveBeenCalledWith("2026-10-26");
  });
});
