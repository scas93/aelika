"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  PortalError,
  fetchPedidos,
  type ListaPedidosPortal,
  type ResumenPedidoPortal,
} from "@/lib/portal-api";
import { porSemanaAscendente } from "@/lib/portal-pedidos-formato";
import BotonWhatsApp from "../boton-whatsapp";
import { BTN_SECUNDARIO, CARD, ERROR, WRAPPER } from "../estilos";
import EncabezadoPantalla from "../encabezado-pantalla";
import TarjetaPedido from "./tarjeta-pedido";
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

  const tarjeta = (p: ResumenPedidoPortal, conSemanaRelativa: boolean) => (
    <TarjetaPedido
      key={p.folio}
      pedido={p}
      conSemanaRelativa={conSemanaRelativa}
      href={`${base}/portal/pedidos/${encodeURIComponent(p.folio)}`}
    />
  );

  return (
    <main className={WRAPPER}>
      <EncabezadoPantalla titulo="Mis pedidos" href={base} />

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
              porSemanaAscendente(lista.activos).map((p) => tarjeta(p, true))
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
              anteriores.map((p) => tarjeta(p, false))
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
