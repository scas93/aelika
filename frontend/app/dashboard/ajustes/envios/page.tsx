"use client";

import { useSession } from "@/lib/session-context";
import PuntosEnvioSection from "../puntos-envio-section";
import VolverAjustesLink from "../volver-link";

export default function AjustesEnviosPage() {
  const { user, token } = useSession();

  return (
    <div className="flex flex-col gap-4">
      <VolverAjustesLink />
      {user.tenant.tipoStorefront === "RETAIL_B2B" ? (
        <p className="text-sm text-admin-ink-soft">Esta sección no aplica a negocios de mayoreo.</p>
      ) : user.rol !== "DUENO" ? (
        <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede editar los ajustes.</p>
      ) : (
        <PuntosEnvioSection token={token} />
      )}
    </div>
  );
}
