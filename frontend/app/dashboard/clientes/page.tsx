"use client";

import { useSession } from "@/lib/session-context";
import ClientesMenudeo from "./clientes-menudeo";
import ClientesB2b from "./clientes-b2b";

// Gerente/Dueño. En un negocio de mayoreo (RETAIL_B2B) esta ruta es el módulo de clientes dados de alta (código, teléfonos autorizados,
// descuento, baja); en uno de menudeo sigue siendo el directorio de siempre (clientes que se crean solos con sus pedidos).
export default function ClientesPage() {
  const { user } = useSession();

  if (user.rol !== "GERENTE" && user.rol !== "DUENO") {
    return <p className="text-sm text-admin-ink-soft">No tienes permiso para ver esta sección.</p>;
  }

  return user.tenant.tipoStorefront === "RETAIL_B2B" ? <ClientesB2b /> : <ClientesMenudeo />;
}
