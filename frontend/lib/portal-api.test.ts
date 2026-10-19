import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PortalError,
  cerrarSesion,
  crearPedido,
  fetchSesion,
  guardarFavoritoDia,
  pedirCodigo,
  problemasDeError,
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

  it("crear pedido: POST a /api-portal/portal/pedidos con cuerpo, encabezado del portal y Idempotency-Key", async () => {
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => respuesta(201, { pedidos: [], total: 0 }));
    await crearPedido(
      "n",
      [{ fecha: "2026-10-05", items: [{ productId: "p", cantidad: 3 }] }],
      "gracias",
      "llave-12345678",
    );
    const [url, init] = f.mock.calls[0];
    const h = init?.headers as Record<string, string>;
    expect(url).toBe("/api-portal/portal/pedidos");
    expect(init?.method).toBe("POST");
    expect(h["x-portal-request"]).toBe("1");
    expect(h["Idempotency-Key"]).toBe("llave-12345678");
    expect(JSON.parse(init?.body as string)).toEqual({
      slug: "n",
      entregas: [
        { fecha: "2026-10-05", items: [{ productId: "p", cantidad: 3 }] },
      ],
      notaCliente: "gracias",
    });
  });

  it("guardar favorito de un día: PUT /favorito/dia con cuerpo y encabezado del portal", async () => {
    const f = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        respuesta(200, { favorito: null, noDisponibles: [] }),
      );
    await guardarFavoritoDia("n", "LUNES", [{ productId: "p", cantidad: 2 }]);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api-portal/portal/favorito/dia");
    expect(init?.method).toBe("PUT");
    expect((init?.headers as Record<string, string>)["x-portal-request"]).toBe(
      "1",
    );
    expect(JSON.parse(init?.body as string)).toEqual({
      slug: "n",
      dia: "LUNES",
      lineas: [{ productId: "p", cantidad: 2 }],
    });
  });

  it("un 409 de crear pedido conserva las fechas rechazadas para mostrarlas", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      respuesta(409, {
        message: "El jueves 1 de octubre ya no se puede pedir",
        fechas: [
          {
            fecha: "2026-10-01",
            motivo: "ANTICIPACION_AGREGAR",
            mensaje: "El jueves 1 de octubre ya no se puede pedir",
          },
        ],
      }),
    );
    const e = await crearPedido("n", [], undefined, "llave-12345678").catch(
      (x) => x,
    );
    expect(e.status).toBe(409);
    expect(problemasDeError(e)).toEqual([
      {
        fecha: "2026-10-01",
        motivo: "ANTICIPACION_AGREGAR",
        mensaje: "El jueves 1 de octubre ya no se puede pedir",
      },
    ]);
    expect(problemasDeError(new Error("x"))).toEqual([]);
  });
});
