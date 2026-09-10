"use client";

import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { createRegla } from "@/lib/api";
import ReglaForm from "../regla-form";

export default function NuevaReglaPage() {
  const { user, token } = useSession();
  const router = useRouter();

  if (user.rol !== "DUENO") {
    return <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede administrar las reglas de notificación.</p>;
  }

  return (
    <ReglaForm
      onSubmit={async (payload) => {
        await createRegla(token, payload);
        router.push("/dashboard/reglas");
      }}
      onCancel={() => router.push("/dashboard/reglas")}
    />
  );
}
