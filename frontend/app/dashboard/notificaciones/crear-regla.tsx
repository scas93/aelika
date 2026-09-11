"use client";

import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { createRegla, type ReglaMensajeCategoria } from "@/lib/api";
import ReglaForm from "./regla-form";

interface CrearReglaProps {
  categoria: ReglaMensajeCategoria;
  basePath: string;
}

// Compartido por .../recontacto/nueva y .../seguimiento/nueva — solo cambia
// `categoria` (fija en el formulario, ver ReglaForm) y a dónde regresa.
export default function CrearRegla({ categoria, basePath }: CrearReglaProps) {
  const { user, token } = useSession();
  const router = useRouter();

  if (user.rol !== "DUENO") {
    return <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede administrar las reglas de notificación.</p>;
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
