"use client";

import ReglaListado from "../regla-listado";

export default function SeguimientoPage() {
  return (
    <ReglaListado
      categoria="UTILITY"
      basePath="/dashboard/notificaciones/seguimiento"
      descripcion="Reglas de seguimiento por WhatsApp — avisos operativos ligados a un pedido o su estatus."
    />
  );
}
