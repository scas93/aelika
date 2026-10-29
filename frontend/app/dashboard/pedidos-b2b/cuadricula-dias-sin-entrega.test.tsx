import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CuadriculaDias, { distribucionVacia } from "./cuadricula-dias";

afterEach(cleanup);

describe("CuadriculaDias · días sin entrega", () => {
  it("el día sin entrega queda deshabilitado, rotulado y con su nota; los demás se pueden capturar", () => {
    render(
      <CuadriculaDias
        nombreProducto="Espiral"
        distribucion={distribucionVacia()}
        onChange={vi.fn()}
        sinEntrega={new Map([["VIERNES", "Navidad"]])}
      />,
    );
    const viernes = screen.getByLabelText("Espiral, Viernes") as HTMLInputElement;
    expect(viernes.disabled).toBe(true);
    expect(viernes.title).toContain("Navidad");
    expect(screen.getByText("Sin entrega")).toBeTruthy();
    expect((screen.getByLabelText("Espiral, Jueves") as HTMLInputElement).disabled).toBe(false);
  });

  it("sin días bloqueados todo queda como antes", () => {
    render(<CuadriculaDias nombreProducto="Espiral" distribucion={distribucionVacia()} onChange={vi.fn()} />);
    expect(screen.queryByText("Sin entrega")).toBeNull();
    expect((screen.getByLabelText("Espiral, Viernes") as HTMLInputElement).disabled).toBe(false);
  });
});
