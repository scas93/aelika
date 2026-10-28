const DESTINO_POR_DEFECTO = "/dashboard";

/**
 * Valida el destino `next` que viaja en `/login?next=…`: solo se acepta una ruta interna del panel (`/dashboard` y
 * lo que cuelgue de él). Todo lo demás —URL absoluta, otro dominio, `//…`, `\`, caracteres de control, otras secciones
 * del sitio— devuelve null y el login usa su destino por defecto (sin redirección abierta).
 */
export function destinoSeguro(next: string | null | undefined): string | null {
  if (!next) return null;
  let ruta = next;
  // Una barra o esquema escondidos tras codificación de porcentaje no deben colarse.
  try {
    ruta = decodeURIComponent(next);
  } catch {
    return null;
  }
  if (/[\\\u0000-\u001f\u007f]/.test(ruta) || ruta.includes("//")) return null;
  const esPanel = ruta === DESTINO_POR_DEFECTO || /^\/dashboard(?:[/?#])/.test(ruta);
  if (!esPanel) return null;
  // Debe seguir siendo una ruta interna del mismo origen una vez resuelta.
  try {
    const url = new URL(next, "http://panel.invalid");
    if (url.origin !== "http://panel.invalid" || !url.pathname.startsWith(DESTINO_POR_DEFECTO)) return null;
  } catch {
    return null;
  }
  return next;
}

/** `/login?next=<ruta y parámetros actuales>`; sin destino válido (o ya en /login) queda `/login` a secas. */
export function urlLoginConDestino(pathname: string, search: string): string {
  const destino = destinoSeguro(`${pathname}${search}`);
  return destino ? `/login?next=${encodeURIComponent(destino)}` : "/login";
}

/** Destino tras iniciar sesión: el `next` de la URL si es válido; si no, `porDefecto`. */
export function destinoTrasLogin(search: string, porDefecto: string): string {
  return destinoSeguro(new URLSearchParams(search).get("next")) ?? porDefecto;
}
