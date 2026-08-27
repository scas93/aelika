"use client";

import { useSession } from "@/lib/session-context";
import CodigosDescuentoB2bSection from "../codigos-descuento-b2b-section";
import VolverAjustesLink from "../volver-link";

export default function AjustesCodigosDescuentoPage() {
  const { user, token } = useSession();

  // Mismo gate que el resto del grupo "Pedidos B2B" (ver
  // ajustes/pedidos-b2b/page.tsx) — accediendo directo por URL sin cumplir
  // la condición se ve un mensaje en vez de redirigir.
  let contenido: React.ReactNode;
  if (user.rol !== "DUENO") {
    contenido = <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede editar los ajustes.</p>;
  } else if (user.tenant.tipoStorefront !== "RETAIL_B2B") {
    contenido = (
      <p className="text-sm text-admin-ink-soft">Los códigos de descuento solo aplican a negocios de mayoreo.</p>
    );
  } else {
    contenido = <CodigosDescuentoB2bSection token={token} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <VolverAjustesLink />
      {contenido}
    </div>
  );
}
