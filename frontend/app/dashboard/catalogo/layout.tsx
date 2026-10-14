"use client";

import { useSession } from "@/lib/session-context";

// El Catálogo está bloqueado del todo para el Operador (docs/diseno-operacion.md, módulo 5): sin link en el sidebar y,
// aquí, sin acceso por URL en ninguna de sus subrutas. La API de lectura de productos sigue abierta para la captura de pedidos.
export default function CatalogoLayout({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  if (user.rol === "OPERADOR") {
    return <p className="text-sm text-admin-ink-soft">No tienes permiso para ver esta sección.</p>;
  }
  return <>{children}</>;
}
