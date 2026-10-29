"use client";

import { useSession } from "@/lib/session-context";
import DiasSinEntregaSection from "../dias-sin-entrega-section";
import { mensajeSinAcceso, puedeVerAjustes } from "../acceso";
import VolverAjustesLink from "../volver-link";

export default function AjustesDiasSinEntregaPage() {
  const { user, token } = useSession();

  return (
    <div className="flex flex-col gap-4">
      <VolverAjustesLink />
      {!puedeVerAjustes(user.rol) ? (
        <p className="text-sm text-admin-ink-soft">{mensajeSinAcceso(user.rol)}</p>
      ) : user.tenant.tipoStorefront !== "RETAIL_B2B" ? (
        <p className="text-sm text-admin-ink-soft">Esta sección solo aplica a negocios de mayoreo.</p>
      ) : (
        <DiasSinEntregaSection token={token} />
      )}
    </div>
  );
}
