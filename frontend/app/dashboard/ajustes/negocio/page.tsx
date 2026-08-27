"use client";

import { useSession } from "@/lib/session-context";
import NegocioSection from "../negocio-section";
import VolverAjustesLink from "../volver-link";

export default function AjustesNegocioPage() {
  const { user, token } = useSession();

  return (
    <div className="flex flex-col gap-4">
      <VolverAjustesLink />
      {user.rol !== "DUENO" ? (
        <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede editar los ajustes.</p>
      ) : (
        <NegocioSection token={token} />
      )}
    </div>
  );
}
