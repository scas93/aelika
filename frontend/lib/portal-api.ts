// Cliente HTTP del acceso al portal del cliente B2B (Fase 4, 4b). Las llamadas van al MISMO dominio del storefront
// (rewrite /api-portal → API, ver next.config.ts): la cookie de sesión es de primera parte y HttpOnly, así que aquí
// nunca se lee ni se guarda un token.

const BASE = "/api-portal/portal/acceso";

export class PortalError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "PortalError";
  }
}

export interface PortalClienteResumen {
  id: string;
  nombre: string;
}

export interface PortalSesion {
  negocio: { nombre: string };
  telefonoTerminacion: string;
  cliente: PortalClienteResumen | null;
  clientes: PortalClienteResumen[];
  requiereSeleccion: boolean;
}

async function llamar<T>(
  ruta: string,
  opciones: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  const method = opciones.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(`${BASE}${ruta}`, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        ...(method === "POST"
          ? { "Content-Type": "application/json", "x-portal-request": "1" }
          : {}),
      },
      body: method === "POST" ? JSON.stringify(opciones.body ?? {}) : undefined,
    });
  } catch {
    throw new PortalError(
      "No pudimos conectarnos. Revisa tu internet e intenta de nuevo",
      0,
    );
  }
  const cuerpo: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      cuerpo && typeof cuerpo === "object" && "message" in cuerpo
        ? (cuerpo as { message: unknown }).message
        : null;
    const texto = Array.isArray(msg)
      ? String(msg[0])
      : typeof msg === "string"
        ? msg
        : null;
    throw new PortalError(
      texto ?? "Algo salió mal. Intenta de nuevo",
      res.status,
    );
  }
  return cuerpo as T;
}

export const pedirCodigo = (slug: string, telefono: string) =>
  llamar<{ ok: boolean; mensaje: string }>("/pedir-codigo", {
    method: "POST",
    body: { slug, telefono },
  });

export const verificarCodigo = (
  slug: string,
  telefono: string,
  codigo: string,
) =>
  llamar<{ ok: boolean; requiereSeleccion: boolean }>("/verificar", {
    method: "POST",
    body: { slug, telefono, codigo },
  });

export const fetchSesion = (slug: string) =>
  llamar<PortalSesion>(`/sesion?slug=${encodeURIComponent(slug)}`);

export const elegirCliente = (slug: string, clienteId: string) =>
  llamar<{ ok: boolean; cliente: PortalClienteResumen }>("/cliente", {
    method: "POST",
    body: { slug, clienteId },
  });

export const cerrarSesion = (slug: string) =>
  llamar<{ ok: boolean }>("/cerrar", { method: "POST", body: { slug } });
