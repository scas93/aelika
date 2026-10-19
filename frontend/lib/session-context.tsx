"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchCurrentUser, type CurrentUser } from "./api";
import { clearSession, loadSession } from "./session";

interface SessionContextValue {
  user: CurrentUser;
  token: string;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState<SessionContextValue | null>(null);
  const token = value?.token;

  useEffect(() => {
    const session = loadSession();
    if (!session) {
      router.replace("/login");
      return;
    }

    fetchCurrentUser(session.accessToken)
      .then((user) => {
        setValue({
          user,
          token: session.accessToken,
          logout: () => {
            clearSession();
            router.push("/login");
          },
        });
      })
      .catch(() => {
        clearSession();
        router.replace("/login");
      });
  }, [router]);

  // Revalida al navegar y al volver a la pestaña: si el Dueño cambió el rol o desactivó al usuario, la nav y las páginas lo
  // reflejan en la siguiente navegación (la API ya lo aplica en cada petición). Un 401 lo maneja request() (va al login).
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const revalidar = () =>
      fetchCurrentUser(token)
        .then((user) => {
          if (cancelled) return;
          setValue((v) => (v && JSON.stringify(v.user) !== JSON.stringify(user) ? { ...v, user } : v));
        })
        .catch(() => {});
    revalidar();
    const alVolver = () => {
      if (document.visibilityState === "visible") revalidar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [token, pathname]);

  if (!value) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-sm text-black/60 dark:text-white/60">
        Cargando...
      </main>
    );
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession debe usarse dentro de SessionProvider");
  }
  return ctx;
}
