"use client";

import { useState } from "react";
import { SessionProvider, useSession } from "@/lib/session-context";
import DashboardNav from "./nav";
import { PageHeader, PageHeaderProvider } from "./_components/PageHeader";

// Teléfono (< 768 px): la barra lateral se oculta y arriba queda una barra fija con ☰ y el nombre del negocio; ☰ abre el menú
// completo encima del contenido.
function BarraMovil({ onAbrirMenu }: { onAbrirMenu: () => void }) {
  const { user } = useSession();
  return (
    <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-admin-border bg-white px-4 md:hidden">
      <button
        type="button"
        onClick={onAbrirMenu}
        aria-label="Abrir menú"
        className="-ml-2 flex h-10 w-10 items-center justify-center text-2xl leading-none text-admin-ink-soft transition hover:text-admin-ink"
      >
        ☰
      </button>
      <span className="min-w-0 truncate text-base font-semibold text-admin-ink">{user.tenant.nombre}</span>
    </header>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <SessionProvider>
      <PageHeaderProvider>
        <div className="flex min-h-screen w-full bg-admin-bg font-admin">
          <DashboardNav open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          {/* min-w-0: sin él, el contenido más ancho (p. ej. una tabla) agranda esta columna más allá de la pantalla y la página gana scroll horizontal. */}
          <div className="flex min-w-0 flex-1 flex-col">
            <BarraMovil onAbrirMenu={() => setSidebarOpen(true)} />
            <main className="mx-auto w-full max-w-[920px] flex-1 p-4 max-md:pt-[4.5rem] md:p-8">
              <PageHeader />
              {children}
            </main>
          </div>
        </div>
      </PageHeaderProvider>
    </SessionProvider>
  );
}
