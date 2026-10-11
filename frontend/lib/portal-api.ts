// Cliente HTTP del acceso al portal del cliente B2B (Fase 4, 4b). Las llamadas van al MISMO dominio del storefront
// (rewrite /api-portal → API, ver next.config.ts): la cookie de sesión es de primera parte y HttpOnly, así que aquí
// nunca se lee ni se guarda un token.

const BASE = "/api-portal/portal/acceso";
const BASE_PORTAL = "/api-portal/portal";

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
  opciones: { method?: "GET" | "POST"; body?: unknown; base?: string } = {},
): Promise<T> {
  const method = opciones.method ?? "GET";
  let res: Response;
  try {
    res = await fetch(`${opciones.base ?? BASE}${ruta}`, {
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

// ---- Calendario (4c). El backend es la única fuente de verdad: aquí solo se tipa y se muestra. ----

export type EstadoDiaPortal =
  "NO_DISPONIBLE" | "AGREGABLE" | "MODIFICABLE" | "CERRADO";
export type MotivoDiaPortal =
  | "PASADO"
  | "ANTICIPACION_AGREGAR"
  | "ANTICIPACION_MODIFICAR"
  | "ENTREGA_CERRADA"
  | "PEDIDO_PAGADO";

export interface DiaCalendarioPortal {
  fecha: string;
  diaSemana: string;
  entregaAt: string;
  estado: EstadoDiaPortal;
  motivo: MotivoDiaPortal | null;
  limiteAt: string | null;
  accion: "CREAR_PEDIDO" | "AGREGAR_A_PEDIDO" | null;
  entrega: { estado: string } | null;
}

export interface SemanaCalendarioPortal {
  semanaInicio: string;
  semanaFin: string;
  esActual: boolean;
  pedido: {
    folio: string;
    estado: string;
    pagado: boolean;
    activo: boolean;
  } | null;
  puedeCrear: boolean;
  dias: DiaCalendarioPortal[];
}

export interface CalendarioPortal {
  ahora: string;
  zonaHoraria: string;
  horaEntrega: string;
  horasAgregar: number;
  horasModificar: number;
  horizonteSemanas: number;
  numeroAtencion: string | null;
  cliente: PortalClienteResumen;
  pedidosActivos: number;
  maximoActivos: number;
  semanas: SemanaCalendarioPortal[];
}

export const fetchCalendario = (slug: string) =>
  llamar<CalendarioPortal>(`/calendario?slug=${encodeURIComponent(slug)}`, {
    base: BASE_PORTAL,
  });
