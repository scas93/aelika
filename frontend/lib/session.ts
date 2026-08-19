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
