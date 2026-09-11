"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchRegla, updateRegla, type Regla, type ReglaMensajeCategoria } from "@/lib/api";
import ReglaForm from "./regla-form";

interface EditarReglaProps {
  id: string;
  categoria: ReglaMensajeCategoria;
  basePath: string;
}

// Compartido por .../recontacto/[id] y .../seguimiento/[id]. `categoria` se
// pasa fija (no se lee de la Regla cargada) porque el submódulo de origen
// ya la determina — si por alguna razón la Regla cargada tuviera otra
// categoría (no debería pasar, el listado de cada submódulo ya filtra por
// la suya), esta pantalla la seguiría guardando con la del submódulo actual,
// no la que traía antes.
export default function EditarRegla({ id, categoria, basePath }: EditarReglaProps) {
  const { user, token } = useSession();
  const router = useRouter();

  const [regla, setRegla] = useState<Regla | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRegla(token, id)
      .then(setRegla)
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar la regla"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (user.rol !== "DUENO") {
    return <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede administrar las reglas de notificación.</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!regla) {
    return <p className="text-sm text-admin-ink-soft">Cargando...</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-extrabold text-admin-ink">Editar &quot;{regla.nombre}&quot;</h1>
      <ReglaForm
        initial={regla}
        categoriaFija={categoria}
        onSubmit={async (payload) => {
          await updateRegla(token, id, payload);
          router.push(basePath);
        }}
        onCancel={() => router.push(basePath)}
      />
    </div>
  );
}
