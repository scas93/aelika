"use client";

import { useSession } from "@/lib/session-context";
import NegocioSection from "../negocio-section";
import { mensajeSinAcceso, puedeVerSubmodulo } from "../acceso";
import VolverAjustesLink from "../volver-link";

export default function AjustesNegocioPage() {
  const { user, token } = useSession();

  return (
    <div className="flex flex-col gap-4">
      <VolverAjustesLink />
      {!puedeVerSubmodulo(user.rol, "/dashboard/ajustes/negocio") ? (
        <p className="text-sm text-admin-ink-soft">{mensajeSinAcceso(user.rol)}</p>
      ) : (
        <NegocioSection token={token} puedeEditarGiro={user.rol === "DUENO"} />
      )}
    </div>
  );
}
