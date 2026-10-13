"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  PortalError,
  fetchPedidosModificables,
  type ResumenPedidoPortal,
} from "@/lib/portal-api";
import { rangoSemana } from "@/lib/portal-pedidos-formato";
import BotonWhatsApp from "../boton-whatsapp";
import { CARD, ERROR, dinero, WRAPPER } from "../estilos";
import EncabezadoPantalla from "../encabezado-pantalla";
import PedidoChips from "../pedidos/pedido-chips";
import { useSesionPortal } from "../pedidos/usar-sesion-portal";

// «Modificar pedido activo»: muestra solo los pedidos en los que hoy se puede cambiar algo. Con uno solo entra directo.
export default function ElegirPedidoModificarPage() {
  const { slug } = useParams<{ slug: string }>();
  const { sesion, numeroAtencion, base, router } = useSesionPortal(slug);
  const [pedidos, setPedidos] = useState<ResumenPedidoPortal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Al volver desde «Modificar pedido» (`?lista=1`) se muestra la lista aunque quede un solo pedido, sin volver a entrar.
  const verLista = useSearchParams().get("lista") === "1";

  useEffect(() => {
    if (!sesion) return;
    let activo = true;
    fetchPedidosModificables(slug)
      .then((r) => {
        if (!activo) return;
        if (r.pedidos.length === 1 && !verLista)
          router.replace(
            `${base}/portal/pedidos/${encodeURIComponent(r.pedidos[0].folio)}/modificar?desde=menu`,
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
  }, [sesion, slug, base, router, verLista]);

  return (
    <main className={WRAPPER}>
      <EncabezadoPantalla titulo="Modificar pedido activo" href={base} />
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
          href={`${base}/portal/pedidos/${encodeURIComponent(p.folio)}/modificar?desde=lista`}
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
