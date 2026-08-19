"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  const [value, setValue] = useState<SessionContextValue | null>(null);

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
