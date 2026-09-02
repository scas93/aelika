import { NextRequest, NextResponse } from "next/server";

// Host que sirve el catálogo público (ej. "pide.aelika.com" en producción,
// "pide.localhost:3000" en desarrollo). Peticiones a ese host se reescriben
// internamente a /tienda/{resto de la ruta} o /mayoreo/{resto de la ruta}
// según el tipoStorefront del tenant, sin exponer ese prefijo en la URL.
const STOREFRONT_HOST = process.env.STOREFRONT_HOST;

// Mismo backend que ya consume el resto del frontend (ver API_URL en
// lib/api.ts) — proxy.ts no puede importar ese módulo (corre fuera del
// árbol de renderizado, ver nota de Next sobre no depender de módulos/
// globals compartidos aquí), así que resuelve la URL por su cuenta con el
// mismo nombre de variable y el mismo default.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Tiempo máximo para la consulta de tipoStorefront antes de rendirse y
// tratarla como fallo — evita que un backend lento o caído cuelgue cada
// visita al storefront público indefinidamente.
const TIMEOUT_MS = 2000;

/**
 * Resuelve tipoStorefront para un slug consultando GET /public/tenants/:slug
 * (expuesto en la fase previa de este cambio). Sin caché deliberadamente —
 * se evaluó agregar una (memoria en el módulo, TTL corto) pero se decidió
 * no hacerlo todavía: hoy no hay tráfico real de producción bajo este host
 * (0 tenants B2B activos, tráfico de staging/local bajo), así que se prefiere
 * medir el impacto real antes de construir una mitigación. Revisar si el
 * volumen crece.
 *
 * `null` significa "no se pudo determinar" (tenant no encontrado, error de
 * red, timeout, respuesta inesperada) — nunca lanza, el caller decide el
 * fallback.
 */
async function resolverTipoStorefront(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/public/tenants/${encodeURIComponent(slug)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (
      typeof data === "object" &&
      data !== null &&
      "tipoStorefront" in data &&
      typeof (data as { tipoStorefront: unknown }).tipoStorefront === "string"
    ) {
      return (data as { tipoStorefront: string }).tipoStorefront;
    }
    return null;
  } catch {
    // Red caída, timeout (AbortSignal.timeout lanza), JSON inválido, etc. —
    // todos tratados igual: no se pudo determinar, ver fallback en proxy().
    return null;
  }
}

export async function proxy(request: NextRequest) {
  if (!STOREFRONT_HOST) return NextResponse.next();

  const host = request.headers.get("host") ?? "";
  if (host !== STOREFRONT_HOST) return NextResponse.next();

  const url = request.nextUrl.clone();
  const slug = url.pathname.split("/").filter(Boolean)[0] ?? "";

  // Sin slug (ej. host visitado en "/") no hay nada que consultar — mismo
  // fallback que un tenant no encontrado: /tienda, el comportamiento de
  // siempre antes de este cambio.
  const tipoStorefront = slug ? await resolverTipoStorefront(slug) : null;

  // Fallback deliberado a /tienda ante cualquier fallo de la consulta
  // (tenant inexistente, red caída, timeout) — no queremos que un error
  // transitorio del backend rompa el acceso al storefront; /tienda es el
  // comportamiento que ya existía antes de este cambio, así que un fallo
  // nunca deja al visitante peor de lo que estaba.
  const prefijo = tipoStorefront === "RETAIL_B2B" ? "/mayoreo" : "/tienda";

  url.pathname = `${prefijo}${url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
