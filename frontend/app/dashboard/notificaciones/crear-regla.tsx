"use client";

import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { createRegla, type ReglaMensajeCategoria } from "@/lib/api";
import ReglaForm from "./regla-form";
import { puedeVerNotificaciones } from "../nav-items";

interface CrearReglaProps {
  categoria: ReglaMensajeCategoria;
  basePath: string;
}

// Compartido por .../recontacto/nueva y .../seguimiento/nueva — solo cambia
// `categoria` (fija en el formulario, ver ReglaForm) y a dónde regresa.
export default function CrearRegla({ categoria, basePath }: CrearReglaProps) {
  const { user, token } = useSession();
  const router = useRouter();

  if (!puedeVerNotificaciones(user.rol, user.tenant.tipoStorefront)) {
    return <p className="text-sm text-admin-ink-soft">No tienes permiso para ver esta sección.</p>;
  }

  return (
    <ReglaForm
      categoriaFija={categoria}
      onSubmit={async (payload) => {
        await createRegla(token, payload);
        router.push(basePath);
      }}
      onCancel={() => router.push(basePath)}
    />
  );
}
