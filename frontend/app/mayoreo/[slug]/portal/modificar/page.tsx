"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  PortalError,
  fetchPedidosModificables,
  type ResumenPedidoPortal,
} from "@/lib/portal-api";
import { rangoSemana } from "@/lib/portal-pedidos-formato";
import BotonWhatsApp from "../boton-whatsapp";
import { BTN_ENLACE, CARD, ERROR, dinero } from "../estilos";
import PedidoChips from "../pedidos/pedido-chips";
import { useSesionPortal } from "../pedidos/usar-sesion-portal";

// «Modificar pedido activo»: muestra solo los pedidos en los que hoy se puede cambiar algo. Con uno solo entra directo.
export default function ElegirPedidoModificarPage() {
  const { slug } = useParams<{ slug: string }>();
  const { sesion, numeroAtencion, base, router } = useSesionPortal(slug);
  const [pedidos, setPedidos] = useState<ResumenPedidoPortal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sesion) return;
    let activo = true;
    fetchPedidosModificables(slug)
      .then((r) => {
        if (!activo) return;
        if (r.pedidos.length === 1)
          router.replace(
            `${base}/portal/pedidos/${encodeURIComponent(r.pedidos[0].folio)}/modificar`,
          );
        else setPedidos(r.pedidos);
      })
      .catch((e: unknown) => {
        if (!activo) return;
        if (e instanceof PortalError && e.status === 401)
          return router.replace(base);
        setError(
          e instanceof PortalError
            ? e.message
            : "Algo salió mal. Intenta de nuevo",
        );
      });
    return () => {
      activo = false;
    };
  }, [sesion, slug, base, router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 bg-mayoreo-bg p-4 font-mayoreo text-mayoreo-ink">
      <header className="flex flex-col gap-1">
        <Link href={base} className={BTN_ENLACE}>
          ← Volver al menú
        </Link>
        <h1 className="text-xl font-bold">Modificar pedido activo</h1>
      </header>
      {error && <p className={ERROR}>{error}</p>}
      {!pedidos && !error && <p className="text-mayoreo-ink-soft">Cargando…</p>}
      {pedidos && pedidos.length === 0 && (
        <div className={CARD}>
          <p className="text-sm text-mayoreo-ink-soft">
            No tienes pedidos que se puedan modificar ahora. Si necesitas un
            cambio, contáctanos.
          </p>
          {sesion?.cliente && (
            <BotonWhatsApp
              numeroAtencion={numeroAtencion}
              contexto={{ tipo: "general", cliente: sesion.cliente.nombre }}
            />
          )}
        </div>
      )}
      {pedidos?.map((p) => (
        <Link
          key={p.folio}
          href={`${base}/portal/pedidos/${encodeURIComponent(p.folio)}/modificar`}
          className="flex flex-col gap-2 rounded-xl border border-mayoreo-border bg-mayoreo-card p-4 shadow-sm active:opacity-80"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-base font-bold">{p.folio}</span>
            <span className="text-base font-semibold">{dinero(p.total)}</span>
          </div>
          <span className="text-sm text-mayoreo-ink-soft">
            Semana del {rangoSemana(p.semanaInicio, p.semanaFin)}
          </span>
          <PedidoChips pedido={p} />
        </Link>
      ))}
    </main>
  );
}
