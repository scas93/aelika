"use client";

import { useState } from "react";
import { useSession } from "@/lib/session-context";
import Tabs from "../_components/Tabs";
import { moduloActivo } from "../nav-items";
import RegistrarClienteTab from "./registrar-cliente-tab";
import RegistrarCompraTab from "./registrar-compra-tab";
import ClientesInscritosTab from "./clientes-inscritos-tab";

type TabKey = "cliente" | "compra" | "inscritos";

// Abierto a los 3 roles (OPERADOR/GERENTE/DUENO) — sin gate adicional aquí:
// es la operación física del día a día del Módulo de Lealtad, mismo
// criterio que /orders (ver nav-items.ts, que no restringe este href).
export default function LealtadPage() {
  const { token, user } = useSession();
  const [tab, setTab] = useState<TabKey>("cliente");

  if (!moduloActivo(user.tenant.modulosDesactivados, "LEALTAD")) {
    return <p className="text-sm text-admin-ink-soft">Este módulo no está habilitado para tu negocio.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        items={[
          { key: "cliente", label: "Registrar nuevo cliente" },
          { key: "compra", label: "Registrar nueva compra" },
          { key: "inscritos", label: "Clientes inscritos" },
        ]}
        active={tab}
        onChange={(key) => setTab(key as TabKey)}
      />
      {tab === "cliente" && <RegistrarClienteTab token={token} slug={user.tenant.slug} />}
      {tab === "compra" && <RegistrarCompraTab token={token} />}
      {tab === "inscritos" && <ClientesInscritosTab token={token} />}
    </div>
  );
}
