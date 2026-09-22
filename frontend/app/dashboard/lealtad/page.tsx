"use client";

import { useState } from "react";
import { useSession } from "@/lib/session-context";
import Tabs from "../_components/Tabs";
import RegistrarClienteTab from "./registrar-cliente-tab";
import RegistrarCompraTab from "./registrar-compra-tab";

type TabKey = "cliente" | "compra";

// Abierto a los 3 roles (OPERADOR/GERENTE/DUENO) — sin gate adicional aquí:
// es la operación física del día a día del Módulo de Lealtad, mismo
// criterio que /orders (ver nav-items.ts, que no restringe este href).
export default function LealtadPage() {
  const { token } = useSession();
  const [tab, setTab] = useState<TabKey>("cliente");

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        items={[
          { key: "cliente", label: "Registrar nuevo cliente" },
          { key: "compra", label: "Registrar nueva compra" },
        ]}
        active={tab}
        onChange={(key) => setTab(key as TabKey)}
      />
      {tab === "cliente" ? <RegistrarClienteTab token={token} /> : <RegistrarCompraTab token={token} />}
    </div>
  );
}
