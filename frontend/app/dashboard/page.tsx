"use client";

import { useSession } from "@/lib/session-context";

export default function DashboardPage() {
  const { user } = useSession();

  return (
    <div className="flex flex-col gap-4 rounded-[10px] bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <h2 className="text-lg font-extrabold text-admin-ink">Hola, {user.nombre}</h2>
      <dl className="flex flex-col gap-2 text-sm">
        <Row label="Correo" value={user.email} />
        <Row label="Rol" value={user.rol} />
        <Row label="Negocio" value={user.tenant.nombre} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-black/10 pb-2">
      <dt className="text-admin-ink/55">{label}</dt>
      <dd className="font-bold text-admin-ink">{value}</dd>
    </div>
  );
}
