"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchTenantSettings, type VentanaRecepcionB2b } from "@/lib/api";
import VentanaRecepcionB2bSection from "../ventana-recepcion-b2b-section";
import VolverAjustesLink from "../volver-link";

export default function AjustesPedidosB2bPage() {
  const { user, token } = useSession();

  // Mismo gate que ya aplicaba VentanaRecepcionB2bSection dentro de la
  // página vieja de Configuración — accediendo directo por URL sin cumplir
  // la condición se ve el mismo mensaje que antes hubiera visto un tenant
  // B2C si esta sección no estuviera oculta, en vez de redirigir.
  let contenido: React.ReactNode;
  if (user.rol !== "DUENO") {
    contenido = <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede editar los ajustes.</p>;
  } else if (user.tenant.tipoStorefront !== "RETAIL_B2B") {
    contenido = (
      <p className="text-sm text-admin-ink-soft">
        La ventana de recepción de pedidos solo aplica a negocios de mayoreo.
      </p>
    );
  } else {
    contenido = <PedidosB2bLoader token={token} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <VolverAjustesLink />
      {contenido}
    </div>
  );
}

function PedidosB2bLoader({ token }: { token: string }) {
  const [ventanaRecepcionB2b, setVentanaRecepcionB2b] = useState<VentanaRecepcionB2b | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetchTenantSettings(token)
      .then((settings) => setVentanaRecepcionB2b(settings.ventanaRecepcionB2b))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar la ventana de recepción"))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return <p className="text-sm text-admin-ink-soft">Cargando...</p>;
  }
  if (loadError) {
    return <p className="text-sm text-red-600">{loadError}</p>;
  }

  return (
    <VentanaRecepcionB2bSection
      token={token}
      ventanaRecepcionB2b={ventanaRecepcionB2b}
      onUpdated={setVentanaRecepcionB2b}
    />
  );
}
