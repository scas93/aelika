"use client";

import { useState } from "react";
import { useSession } from "@/lib/session-context";
import Tabs from "../_components/Tabs";
import ClientesTab from "./clientes-tab";
import InternoTab from "./interno-tab";

type TabKey = "clientes" | "interno";

// Solo lectura. Solo Dueño y solo negocios de mayoreo (el backend aplica lo mismo; esto es solo la cara del gate).
export default function AdopcionPage() {
  const { user, token } = useSession();
  const [tab, setTab] = useState<TabKey>("clientes");

  if (user.rol !== "DUENO" || user.tenant.tipoStorefront !== "RETAIL_B2B") {
    return <p className="text-sm text-admin-ink-soft">Solo el dueño de un negocio de mayoreo puede ver Adopción.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        items={[
          { key: "clientes", label: "Clientes" },
          { key: "interno", label: "Interno" },
        ]}
        active={tab}
        onChange={(key) => setTab(key as TabKey)}
      />
      {tab === "clientes" && <ClientesTab token={token} />}
      {tab === "interno" && <InternoTab token={token} />}
    </div>
  );
}
