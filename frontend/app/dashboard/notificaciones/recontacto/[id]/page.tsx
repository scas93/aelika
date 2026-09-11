"use client";

import { useParams } from "next/navigation";
import EditarRegla from "../../editar-regla";

export default function EditarReglaRecontactoPage() {
  const params = useParams<{ id: string }>();
  return <EditarRegla id={params.id} categoria="MARKETING" basePath="/dashboard/notificaciones/recontacto" />;
}
