import Link from "next/link";

// Mismo patrón que "← Volver al catálogo" en
// catalogo/productos/[id]/page.tsx — único precedente de link de regreso que
// ya existía en el panel. Un solo componente compartido por las 7 subrutas
// de /dashboard/ajustes/* para que la colocación y el estilo sean idénticos
// en todas, en vez de repetir el mismo JSX 7 veces.
export default function VolverAjustesLink() {
  return (
    <Link href="/dashboard/ajustes" className="text-sm font-semibold text-admin-ink-soft hover:text-admin-ink">
      ← Volver a Ajustes
    </Link>
  );
}
