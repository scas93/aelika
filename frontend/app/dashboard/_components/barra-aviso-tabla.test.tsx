import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/dashboard/x" }));

import BarraBusqueda from "./BarraFiltros";
import Aviso from "./Aviso";
import BotonExportar from "./BotonExportar";
import Table from "./Table";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BarraBusqueda", () => {
  beforeEach(() => vi.useFakeTimers());

  it("busca mientras escribes (con una pequeña espera), sin botón «Buscar»", () => {
    const onBuscar = vi.fn();
    render(<BarraBusqueda placeholder="Buscar negocio…" onBuscar={onBuscar} />);
    expect(screen.queryByRole("button", { name: "Buscar" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Filtros/ })).toBeNull(); // sin filtros, sin botón «Filtros»
    fireEvent.change(screen.getByPlaceholderText("Buscar negocio…"), { target: { value: "au" } });
    expect(onBuscar).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(350));
    expect(onBuscar).toHaveBeenCalledWith("au");
  });

  it("«Filtros» abre un panel con todos; activos salen como chips con ✕ y «Limpiar filtros»", () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <BarraBusqueda
        filtros={[
          { key: "a", label: "Estado", valueLabel: null, onClear, render: () => <span>contenido estado</span> },
          { key: "b", label: "Pago", valueLabel: null, onClear: () => {}, render: () => <span>contenido pago</span> },
        ]}
      />,
    );
    expect(screen.queryByText("Limpiar filtros")).toBeNull(); // sin chips si no hay filtros activos
    fireEvent.click(screen.getByRole("button", { name: /Filtros/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Estado/ }));
    expect(screen.getByText("contenido estado")).toBeTruthy();
    rerender(
      <BarraBusqueda
        filtros={[
          { key: "a", label: "Estado", valueLabel: "Cancelado", onClear, render: () => <span>contenido estado</span> },
          { key: "b", label: "Pago", valueLabel: null, onClear: () => {}, render: () => <span>contenido pago</span> },
        ]}
      />,
    );
    expect(screen.getByText(/Estado: Cancelado/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtro de Estado" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(onClear).toHaveBeenCalledTimes(2);
  });
});

describe("Aviso", () => {
  it("una línea con ícono, acción como enlace y ✕ solo si se puede descartar", () => {
    const onClick = vi.fn();
    const onDescartar = vi.fn();
    const { rerender } = render(
      <Aviso tono="ambar" accion={{ label: "Ver", onClick }}>
        Tienes 4 pedidos
      </Aviso>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Tienes 4 pedidos");
    fireEvent.click(screen.getByRole("button", { name: "Ver" }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Descartar aviso" })).toBeNull();
    rerender(
      <Aviso tono="neutro" onDescartar={onDescartar}>
        Info
      </Aviso>,
    );
    expect(screen.getByRole("status")).toBeTruthy(); // neutro = informativo
    fireEvent.click(screen.getByRole("button", { name: "Descartar aviso" }));
    expect(onDescartar).toHaveBeenCalled();
  });

  it("tono rojo = alerta", () => {
    render(<Aviso tono="rojo">Cancelado</Aviso>);
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

describe("BotonExportar", () => {
  it("solo ícono, con tooltip y nombre accesible", () => {
    const onClick = vi.fn();
    render(<BotonExportar label="Exportar Excel" onClick={onClick} />);
    const b = screen.getByRole("button", { name: "Exportar Excel" });
    expect(b.getAttribute("title")).toBe("Exportar Excel");
    expect(b.textContent).toBe("");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalled();
  });
});

describe("Table (paginación con conteo abajo)", () => {
  const columns = [{ key: "n", header: "N", render: (r: { n: string }) => r.n }];
  it("«1–20 de 46 resultados» con flechas", () => {
    const onNext = vi.fn();
    render(
      <Table columns={columns} data={[{ n: "a" }]} rowKey={(r) => r.n} pagination={{ page: 1, totalPages: 3, total: 46, limit: 20, onPrevious: () => {}, onNext }} />,
    );
    expect(screen.getByText("1–20 de 46 resultados")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Página anterior" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(onNext).toHaveBeenCalled();
  });
  it("última página: «41–46 de 46 resultados»", () => {
    render(<Table columns={columns} data={[{ n: "a" }]} rowKey={(r) => r.n} pagination={{ page: 3, totalPages: 3, total: 46, limit: 20, onPrevious: () => {}, onNext: () => {} }} />);
    expect(screen.getByText("41–46 de 46 resultados")).toBeTruthy();
  });
});
