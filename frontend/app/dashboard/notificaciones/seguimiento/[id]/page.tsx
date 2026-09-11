"use client";

import { useParams } from "next/navigation";
import EditarRegla from "../../editar-regla";

export default function EditarReglaSeguimientoPage() {
  const params = useParams<{ id: string }>();
  return <EditarRegla id={params.id} categoria="UTILITY" basePath="/dashboard/notificaciones/seguimiento" />;
}
