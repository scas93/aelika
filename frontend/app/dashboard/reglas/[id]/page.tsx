"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchRegla, updateRegla, type Regla } from "@/lib/api";
import ReglaForm from "../regla-form";

export default function EditarReglaPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
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
        onSubmit={async (payload) => {
          await updateRegla(token, id, payload);
          router.push("/dashboard/reglas");
        }}
        onCancel={() => router.push("/dashboard/reglas")}
      />
    </div>
  );
}
