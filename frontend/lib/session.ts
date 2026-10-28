import type { Session } from "./api";

const STORAGE_KEY = "aelika_session";

export function saveSession(session: Session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function loadSession(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

const AVISO_KEY = "aelika_aviso_login";
export const AVISO_SESION_INVALIDA =
  "Tu sesión terminó: tu usuario fue desactivado o la sesión venció. Inicia sesión de nuevo o contacta al Admin del negocio.";

// Limpia la sesión local, deja un aviso para el login y manda a /login (recarga completa para cortar cualquier estado).
export function avisarSesionInvalida() {
  if (typeof window === "undefined") return;
  clearSession();
  try {
    sessionStorage.setItem(AVISO_KEY, AVISO_SESION_INVALIDA);
  } catch {
    // sin sessionStorage el login simplemente no muestra aviso
  }
  if (window.location.pathname !== "/login") window.location.replace("/login");
}

export function consumirAvisoLogin(): string | null {
  try {
    const aviso = sessionStorage.getItem(AVISO_KEY);
    sessionStorage.removeItem(AVISO_KEY);
    return aviso;
  } catch {
    return null;
  }
}
