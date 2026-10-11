import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PortalError,
  cerrarSesion,
  fetchSesion,
  pedirCodigo,
  verificarCodigo,
} from "./portal-api";

function respuesta(status: number, cuerpo: unknown) {
  return Promise.resolve(new Response(JSON.stringify(cuerpo), { status }));
}

afterEach(() => vi.restoreAllMocks());

describe("portal-api", () => {
  it("las escrituras van al mismo dominio con el encabezado del portal y sin credenciales manuales", async () => {
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => respuesta(200, { ok: true, mensaje: "x" }));
    await pedirCodigo("banetto-mayorista", "3331006915");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api-portal/portal/acceso/pedir-codigo");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["x-portal-request"]).toBe(
      "1",
    );
    expect(init?.credentials).toBe("same-origin");
    expect(JSON.parse(init?.body as string)).toEqual({
      slug: "banetto-mayorista",
      telefono: "3331006915",
    });
  });

  it("GET sesión lleva el slug en la query y no manda encabezado de escritura", async () => {
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => respuesta(200, { negocio: { nombre: "N" } }));
    await fetchSesion("mi-negocio");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api-portal/portal/acceso/sesion?slug=mi-negocio");
    expect(init?.method).toBe("GET");
    expect(
      (init?.headers as Record<string, string>)["x-portal-request"],
    ).toBeUndefined();
  });

  it("errores: toma el mensaje del servidor y conserva el status", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respuesta(429, { message: "Pediste demasiados códigos." }),
    );
    await expect(pedirCodigo("n", "3331006915")).rejects.toMatchObject({
      name: "PortalError",
      status: 429,
      message: "Pediste demasiados códigos.",
    });
  });

  it("error de validación con arreglo de mensajes → el primero", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respuesta(400, { message: ["slug inválido", "otro"] }),
    );
    await expect(verificarCodigo("n", "1", "2")).rejects.toThrow(
      "slug inválido",
    );
  });

  it("sin conexión → mensaje claro y status 0", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.reject(new TypeError("fail")),
    );
    const e = await cerrarSesion("n").catch((x) => x);
    expect(e).toBeInstanceOf(PortalError);
    expect(e.status).toBe(0);
    expect(e.message).toMatch(/conectarnos/);
  });
});
