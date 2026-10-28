import { describe, expect, it } from "vitest";
import { destinoSeguro, destinoTrasLogin, urlLoginConDestino } from "./destino-login";

describe("destinoSeguro", () => {
  it("acepta rutas del panel con sus parámetros", () => {
    expect(destinoSeguro("/dashboard")).toBe("/dashboard");
    expect(destinoSeguro("/dashboard/pedidos-b2b?pedido=abc-123")).toBe("/dashboard/pedidos-b2b?pedido=abc-123");
    expect(destinoSeguro("/dashboard/adopcion?semana=2026-10-26&x=1")).toBe("/dashboard/adopcion?semana=2026-10-26&x=1");
  });

  it.each([
    ["URL absoluta", "https://evil.com/dashboard"],
    ["otro dominio sin esquema", "//evil.com/dashboard"],
    ["// dentro de la ruta", "/dashboard//evil.com"],
    ["esquema javascript", "javascript:alert(1)"],
    ["barra invertida", "/dashboard\\..\\evil"],
    ["barra codificada", "%2F%2Fevil.com"],
    ["fuera del panel", "/tienda/banetto"],
    ["prefijo parecido", "/dashboardx"],
    ["login mismo", "/login"],
    ["salto de línea", "/dashboard\n/evil"],
    ["porcentaje inválido", "/dashboard%"],
    ["vacío", ""],
    ["null", null],
  ])("rechaza %s", (_c, valor) => {
    expect(destinoSeguro(valor as string | null)).toBeNull();
  });
});

describe("urlLoginConDestino", () => {
  it("conserva ruta y parámetros", () => {
    const url = urlLoginConDestino("/dashboard/pedidos-b2b", "?pedido=abc");
    expect(url).toBe("/login?next=%2Fdashboard%2Fpedidos-b2b%3Fpedido%3Dabc");
    expect(destinoTrasLogin(url.split("?")[1] ? `?${url.split("?")[1]}` : "", "/dashboard")).toBe("/dashboard/pedidos-b2b?pedido=abc");
  });

  it("fuera del panel o ya en /login queda /login a secas", () => {
    expect(urlLoginConDestino("/login", "")).toBe("/login");
    expect(urlLoginConDestino("/tienda/x", "")).toBe("/login");
  });
});

describe("destinoTrasLogin", () => {
  it("sin next usa el destino por defecto (incluido el del Operador B2C)", () => {
    expect(destinoTrasLogin("", "/dashboard")).toBe("/dashboard");
    expect(destinoTrasLogin("", "/dashboard/pedidos")).toBe("/dashboard/pedidos");
  });

  it("con next válido lo usa, también el Operador", () => {
    expect(destinoTrasLogin("?next=%2Fdashboard%2Fadopcion%3Fsemana%3D1", "/dashboard/pedidos")).toBe("/dashboard/adopcion?semana=1");
  });

  it("con next inválido usa el destino por defecto", () => {
    expect(destinoTrasLogin("?next=https%3A%2F%2Fevil.com", "/dashboard")).toBe("/dashboard");
    expect(destinoTrasLogin("?next=%2F%2Fevil.com", "/dashboard")).toBe("/dashboard");
    expect(destinoTrasLogin("?next=%2Ftienda%2Fx", "/dashboard/pedidos")).toBe("/dashboard/pedidos");
  });
});
