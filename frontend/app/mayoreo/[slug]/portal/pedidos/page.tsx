"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  PortalError,
  fetchPedidos,
  type ListaPedidosPortal,
  type ResumenPedidoPortal,
} from "@/lib/portal-api";
import { rangoSemana } from "@/lib/portal-pedidos-formato";
import BotonWhatsApp from "../boton-whatsapp";
import { BTN_ENLACE, BTN_SECUNDARIO, CARD, ERROR, dinero } from "../estilos";
import PedidoChips from "./pedido-chips";
import { useSesionPortal } from "./usar-sesion-portal";

// Ver mis pedidos (4e): activos arriba, anteriores paginados abajo. Cada tarjeta lleva al detalle (folio en la URL).
export default function MisPedidosPage() {
  const { slug } = useParams<{ slug: string }>();
  const { sesion, numeroAtencion, base, router } = useSesionPortal(slug);
  const [lista, setLista] = useState<ListaPedidosPortal | null>(null);
  const [anteriores, setAnteriores] = useState<ResumenPedidoPortal[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);

  const manejarError = useCallback(
    (e: unknown) => {
      if (e instanceof PortalError && e.status === 401)
        return router.replace(base);
      setError(
        e instanceof PortalError
          ? e.message
          : "Algo salió mal. Intenta de nuevo",
      );
    },
    [base, router],
  );

  useEffect(() => {
    if (!sesion) return;
    let activo = true;
    fetchPedidos(slug)
      .then((l) => {
        if (!activo) return;
        setLista(l);
        setAnteriores(l.anteriores);
        setCursor(l.siguienteCursor);
      })
      .catch((e: unknown) => activo && manejarError(e));
    return () => {
      activo = false;
    };
  }, [sesion, slug, manejarError]);

  async function verMas() {
    if (!cursor) return;
    setCargandoMas(true);
    try {
      const l = await fetchPedidos(slug, cursor);
      setAnteriores((a) => [...a, ...l.anteriores]);
      setCursor(l.siguienteCursor);
    } catch (e) {
      manejarError(e);
    } finally {
      setCargandoMas(false);
    }
  }

  const tarjeta = (p: ResumenPedidoPortal) => (
    <Link
      key={p.folio}
      href={`${base}/portal/pedidos/${encodeURIComponent(p.folio)}`}
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
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 bg-mayoreo-bg p-4 font-mayoreo text-mayoreo-ink">
      <header className="flex flex-col gap-1">
        <Link href={base} className={BTN_ENLACE}>
          ← Volver al menú
        </Link>
        <h1 className="text-xl font-bold">Mis pedidos</h1>
        {sesion?.cliente && (
          <p className="text-sm text-mayoreo-ink-soft">
            {sesion.cliente.nombre}
          </p>
        )}
      </header>

      {error && <p className={ERROR}>{error}</p>}
      {!lista && !error && <p className="text-mayoreo-ink-soft">Cargando…</p>}

      {lista && (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Activos</h2>
            {lista.activos.length === 0 ? (
              <div className={CARD}>
                <p className="text-sm text-mayoreo-ink-soft">
                  No tienes pedidos activos.
                </p>
              </div>
            ) : (
              lista.activos.map(tarjeta)
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Anteriores</h2>
            {anteriores.length === 0 ? (
              <div className={CARD}>
                <p className="text-sm text-mayoreo-ink-soft">
                  Aún no tienes pedidos anteriores.
                </p>
              </div>
            ) : (
              anteriores.map(tarjeta)
            )}
            {cursor && (
              <button
                className={BTN_SECUNDARIO}
                disabled={cargandoMas}
                onClick={() => void verMas()}
              >
                {cargandoMas ? "Cargando…" : "Ver más"}
              </button>
            )}
          </section>

          {sesion?.cliente && (
            <BotonWhatsApp
              numeroAtencion={numeroAtencion}
              contexto={{ tipo: "general", cliente: sesion.cliente.nombre }}
            />
          )}
        </>
      )}
    </main>
  );
}
