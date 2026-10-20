import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import Calendario, { lunesDe, domingoDe } from "./Calendario";
import { FiltroFechaPopover, labelFiltroFecha, resolverFiltroFecha, resolverFiltroSemana } from "./FiltroFecha";
import { FiltroImportePopover, labelFiltroImporte } from "./FiltroImporteControl";
import { FiltroSelectPopover } from "./FiltroSelect";

afterEach(cleanup);

describe("Calendario (fecha)", () => {
  it("el rango se aplica al elegir la segunda fecha, en cualquier orden", () => {
    const onElegir = vi.fn();
    render(<Calendario valor={{ desde: "2026-10-01", hasta: "2026-10-01" }} onElegir={onElegir} />);
    fireEvent.click(screen.getByLabelText("2026-10-19"));
    expect(onElegir).not.toHaveBeenCalled(); // solo la primera
    fireEvent.click(screen.getByLabelText("2026-10-01"));
    expect(onElegir).toHaveBeenCalledWith({ desde: "2026-10-01", hasta: "2026-10-19" });
  });

  it("modo semana: cada clic toma la semana completa (lunes a domingo)", () => {
    const onElegir = vi.fn();
    render(<Calendario modo="semana" valor={{ desde: "2026-10-05", hasta: "2026-10-11" }} onElegir={onElegir} />);
    fireEvent.click(screen.getByLabelText("2026-10-07")); // miércoles → semana del 5
    fireEvent.click(screen.getByLabelText("2026-10-21")); // miércoles → semana del 19
    expect(onElegir).toHaveBeenCalledWith({ desde: "2026-10-05", hasta: "2026-10-25" });
  });

  it("modo semana: la misma semana dos veces, y semanas elegidas al revés", () => {
    const onElegir = vi.fn();
    render(<Calendario modo="semana" valor={null} onElegir={onElegir} />);
    fireEvent.click(screen.getByLabelText(`${new Date().toISOString().slice(0, 8)}15`));
    fireEvent.click(screen.getByLabelText(`${new Date().toISOString().slice(0, 8)}15`));
    const [{ desde, hasta }] = onElegir.mock.calls[0];
    expect(desde).toBe(lunesDe(desde));
    expect(hasta).toBe(domingoDe(desde));
  });

  it("lunesDe / domingoDe", () => {
    expect(lunesDe("2026-10-21")).toBe("2026-10-19");
    expect(domingoDe("2026-10-21")).toBe("2026-10-25");
    expect(lunesDe("2026-10-25")).toBe("2026-10-19"); // domingo → lunes anterior
  });
});

describe("FiltroFecha", () => {
  it("al elegir la segunda fecha aplica y cierra, sin modo relativo ni «Aplicar»", () => {
    const onAplicar = vi.fn();
    const close = vi.fn();
    render(<FiltroFechaPopover valorAplicado={{ desde: "2026-10-01", hasta: "2026-10-01" }} onAplicar={onAplicar} close={close} />);
    expect(screen.queryByText("Relativo")).toBeNull();
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
    fireEvent.click(screen.getByLabelText("2026-10-03"));
    fireEvent.click(screen.getByLabelText("2026-10-19"));
    expect(onAplicar).toHaveBeenCalledWith({ desde: "2026-10-03", hasta: "2026-10-19" });
    expect(close).toHaveBeenCalled();
  });

  it("etiqueta del chip: «1–19 oct»", () => {
    const anio = new Date().getFullYear();
    expect(labelFiltroFecha({ desde: `${anio}-10-01`, hasta: `${anio}-10-19` })).toBe("1–19 oct");
    expect(labelFiltroFecha({ desde: `${anio}-09-28`, hasta: `${anio}-10-05` })).toBe("28 sep – 5 oct");
    expect(labelFiltroFecha({ desde: `${anio}-10-19`, hasta: `${anio}-10-19` })).toBe("19 oct");
    expect(labelFiltroFecha({ desde: "2024-12-30", hasta: "2025-01-05" })).toBe("30 dic 2024 – 5 ene 2025");
    expect(labelFiltroFecha(null)).toBeNull();
  });

  it("semana: ambos extremos a medianoche UTC (el domingo no deja entrar el lunes siguiente); fecha: fin del día local", () => {
    expect(resolverFiltroSemana({ desde: "2026-10-05", hasta: "2026-10-25" })).toStrictEqual({
      desde: "2026-10-05T00:00:00.000Z",
      hasta: "2026-10-25T00:00:00.000Z",
    });
    expect(resolverFiltroFecha({ desde: "2026-10-05", hasta: "2026-10-05" }).desde).toBe("2026-10-05T00:00:00.000Z");
  });
});

describe("FiltroSelect", () => {
  it("lista directa; elegir una opción aplica y cierra", () => {
    const onAplicar = vi.fn();
    const close = vi.fn();
    render(<FiltroSelectPopover opciones={[{ value: "A", label: "Uno" }, { value: "B", label: "Dos" }]} valorAplicado="A" onAplicar={onAplicar} close={close} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("option", { name: /Uno/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: "Dos" }));
    expect(onAplicar).toHaveBeenCalledWith("B");
    expect(close).toHaveBeenCalled();
  });
});

describe("FiltroImporte (Total)", () => {
  it("mínimo y máximo: Enter aplica «entre» y cierra", () => {
    const onAplicar = vi.fn();
    const close = vi.fn();
    render(<FiltroImportePopover valorAplicado={null} onAplicar={onAplicar} close={close} />);
    fireEvent.change(screen.getByLabelText("Mínimo"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Máximo"), { target: { value: "500" } });
    fireEvent.keyDown(screen.getByLabelText("Máximo"), { key: "Enter" });
    expect(onAplicar).toHaveBeenCalledTimes(1);
    expect(onAplicar).toHaveBeenCalledWith({ operador: "ENTRE", valor: 100, valorHasta: 500 });
    expect(close).toHaveBeenCalled();
  });

  it("al salir del campo aplica; solo mínimo = «≥», solo máximo = «≤»; vacío quita el filtro; sin aplicar dos veces", () => {
    const onAplicar = vi.fn();
    render(<FiltroImportePopover valorAplicado={null} onAplicar={onAplicar} close={() => {}} />);
    fireEvent.change(screen.getByLabelText("Mínimo"), { target: { value: "200" } });
    fireEvent.blur(screen.getByLabelText("Mínimo"));
    expect(onAplicar).toHaveBeenLastCalledWith({ operador: "MAYOR_IGUAL", valor: 200 });
    fireEvent.blur(screen.getByLabelText("Máximo")); // mismo valor: no vuelve a aplicar
    expect(onAplicar).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Mínimo"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Máximo"), { target: { value: "50" } });
    fireEvent.blur(screen.getByLabelText("Máximo"));
    expect(onAplicar).toHaveBeenLastCalledWith({ operador: "MENOR_IGUAL", valor: 50 });
    fireEvent.change(screen.getByLabelText("Máximo"), { target: { value: "" } });
    fireEvent.blur(screen.getByLabelText("Máximo"));
    expect(onAplicar).toHaveBeenLastCalledWith(null);
  });

  it("mínimo mayor que máximo: no aplica y avisa", () => {
    const onAplicar = vi.fn();
    render(<FiltroImportePopover valorAplicado={null} onAplicar={onAplicar} close={() => {}} />);
    fireEvent.change(screen.getByLabelText("Mínimo"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Máximo"), { target: { value: "100" } });
    fireEvent.blur(screen.getByLabelText("Máximo"));
    expect(onAplicar).not.toHaveBeenCalled();
    expect(screen.getByText("El mínimo no puede ser mayor que el máximo")).toBeTruthy();
  });

  it("etiqueta del chip", () => {
    expect(labelFiltroImporte({ operador: "ENTRE", valor: 100, valorHasta: 500 })).toBe("entre $100.00 y $500.00");
    expect(labelFiltroImporte({ operador: "MAYOR_IGUAL", valor: 200 })).toBe("≥ $200.00");
  });
});
