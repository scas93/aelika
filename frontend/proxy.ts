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
  const targetUrl = `${API_URL}/public/tenants/${encodeURIComponent(slug)}`;

  // TEMPORAL — instrumentación de diagnóstico para el fallback inesperado a
  // /tienda visto en staging para tenants RETAIL_B2B. Quitar en el prompt de
  // limpieza aparte, una vez diagnosticado (no antes).
  console.log("[DEBUG-PROXY] consultando tipoStorefront", {
    slug,
    targetUrl,
    NEXT_PUBLIC_API_URL_env: process.env.NEXT_PUBLIC_API_URL,
    API_URL_resuelta: API_URL,
  });

  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      // TEMPORAL — ver comentario arriba.
      console.log("[DEBUG-PROXY] fetch respondió con status no-200", {
        slug,
        targetUrl,
        status: res.status,
        statusText: res.statusText,
      });
      return null;
    }

    const data: unknown = await res.json();
    if (
      typeof data === "object" &&
      data !== null &&
      "tipoStorefront" in data &&
      typeof (data as { tipoStorefront: unknown }).tipoStorefront === "string"
    ) {
      const tipoStorefront = (data as { tipoStorefront: string }).tipoStorefront;
      // TEMPORAL — ver comentario arriba.
      console.log("[DEBUG-PROXY] fetch exitoso", { slug, targetUrl, tipoStorefront });
      return tipoStorefront;
    }

    // TEMPORAL — ver comentario arriba.
    console.log("[DEBUG-PROXY] fetch exitoso pero la respuesta no trae tipoStorefront válido", {
      slug,
      targetUrl,
      data,
    });
    return null;
  } catch (err) {
    const esError = err instanceof Error;
    // AbortSignal.timeout() rechaza con un error cuyo `name` es "TimeoutError"
    // — cualquier otro nombre (TypeError de fetch, etc.) es un fallo de red
    // real, no un timeout.
    const tipoError = esError && err.name === "TimeoutError" ? "timeout" : esError ? "red" : "desconocido";
    // TEMPORAL — ver comentario arriba.
    console.log("[DEBUG-PROXY] fetch falló", {
      slug,
      targetUrl,
      tipoError,
      errorNombre: esError ? err.name : undefined,
      errorMensaje: esError ? err.message : String(err),
    });
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

  // TEMPORAL — ver nota en resolverTipoStorefront. Quitar junto con el resto
  // de este logging en el prompt de limpieza.
  console.log("[DEBUG-PROXY] decisión final de reescritura", {
    host,
    pathnameOriginal: url.pathname,
    slug,
    tipoStorefront,
    prefijo,
    razon: !slug
      ? "sin slug en el path"
      : tipoStorefront
        ? `consulta exitosa, tipoStorefront=${tipoStorefront}`
        : "fallback a /tienda por fallo en la consulta (ver logs [DEBUG-PROXY] de resolverTipoStorefront arriba)",
  });

  url.pathname = `${prefijo}${url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
