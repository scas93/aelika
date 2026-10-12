"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  PortalError,
  fetchPedido,
  usarPedidoComoFavorito,
  type DetallePedidoPortal,
} from "@/lib/portal-api";
import {
  etiquetaFechaEntrega,
  rangoSemana,
} from "@/lib/portal-pedidos-formato";
import BotonWhatsApp from "../../boton-whatsapp";
import {
  AVISO,
  BTN_ENLACE,
  BTN_PRIMARIO,
  BTN_SECUNDARIO,
  CARD,
  ERROR,
  dinero,
} from "../../estilos";
import PedidoChips from "../pedido-chips";
import { useSesionPortal } from "../usar-sesion-portal";

// Detalle de un pedido (4e): entregas por fecha con su estado, productos, descuento, nota y total. Solo lectura.
export default function DetallePedidoPage() {
  const { slug, folio } = useParams<{ slug: string; folio: string }>();
  const { sesion, numeroAtencion, base, router } = useSesionPortal(slug);
  const [pedido, setPedido] = useState<DetallePedidoPortal | null>(null);
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!sesion) return;
    let activo = true;
    fetchPedido(slug, decodeURIComponent(folio))
      .then((p) => activo && setPedido(p))
      .catch((e: unknown) => {
        if (!activo) return;
        if (e instanceof PortalError && e.status === 401)
          return router.replace(base);
        if (e instanceof PortalError && e.status === 404)
          return setNoEncontrado(true);
        setError(
          e instanceof PortalError
            ? e.message
            : "Algo salió mal. Intenta de nuevo",
        );
      });
    return () => {
      activo = false;
    };
  }, [sesion, slug, folio, base, router]);

  async function usarComoFavorito() {
    if (!pedido) return;
    if (
      !pedido.esFavorito &&
      !window.confirm(
        "Este pedido reemplazará tu pedido favorito actual (solo se guarda uno). ¿Continuar?",
      )
    )
      return;
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await usarPedidoComoFavorito(slug, pedido.folio);
      setPedido({ ...pedido, esFavorito: r.omitidos.length === 0 });
      setAviso(
        r.omitidos.length
          ? `Guardado como favorito. No se incluyeron: ${r.omitidos.join(", ")} (ya no están disponibles).`
          : "Listo, este pedido es tu favorito.",
      );
    } catch (e) {
      if (e instanceof PortalError && e.status === 401)
        return router.replace(base);
      setError(
        e instanceof PortalError
          ? e.message
          : "Algo salió mal. Intenta de nuevo",
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 bg-mayoreo-bg p-4 font-mayoreo text-mayoreo-ink">
      <header className="flex flex-col gap-1">
        <Link href={`${base}/portal/pedidos`} className={BTN_ENLACE}>
          ← Mis pedidos
        </Link>
      </header>

      {noEncontrado && (
        <div className={CARD}>
          <p className="text-sm text-mayoreo-ink-soft">
            No encontramos este pedido.
          </p>
        </div>
      )}
      {error && <p className={ERROR}>{error}</p>}
      {!pedido && !noEncontrado && !error && (
        <p className="text-mayoreo-ink-soft">Cargando…</p>
      )}

      {pedido && (
        <>
          <section className={CARD + " gap-2"}>
            <div className="flex items-baseline justify-between gap-2">
              <h1 className="text-xl font-bold">{pedido.folio}</h1>
              <span className="text-xl font-bold">{dinero(pedido.total)}</span>
            </div>
            <p className="text-sm text-mayoreo-ink-soft">
              Semana del {rangoSemana(pedido.semanaInicio, pedido.semanaFin)}
            </p>
            <PedidoChips pedido={pedido} conFechaPago />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Entregas</h2>
            {pedido.entregas.map((e) => (
              <div
                key={e.fecha}
                className="flex flex-col gap-2 rounded-xl border border-mayoreo-border bg-mayoreo-card p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold capitalize">
                    {etiquetaFechaEntrega(e.fecha)}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      e.estado.codigo === "CANCELADA"
                        ? "bg-red-50 text-red-700"
                        : e.estado.codigo === "ENTREGADA"
                          ? "bg-green-50 text-green-800"
                          : "bg-mayoreo-accent-soft text-mayoreo-ink"
                    }`}
                  >
                    {e.estado.etiqueta}
                  </span>
                </div>
                <ul className="flex flex-col gap-1">
                  {e.productos.map((p) => (
                    <li
                      key={p.nombre}
                      className="flex items-baseline justify-between gap-2 text-sm"
                    >
                      <span>
                        {p.cantidad} × {p.nombre}
                        <span className="text-mayoreo-ink-soft">
                          {" "}
                          ({dinero(p.precioUnitario)} c/u)
                        </span>
                      </span>
                      <span>{dinero(p.subtotal)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section className={CARD + " gap-2"}>
            <div className="flex justify-between text-sm">
              <span>Subtotal</span>
              <span>{dinero(pedido.subtotal)}</span>
            </div>
            {pedido.descuentoTotal > 0 && (
              <div className="flex justify-between text-sm">
                <span>Descuento ({pedido.descuentoPorcentaje}%)</span>
                <span>−{dinero(pedido.descuentoTotal)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold">
              <span>Total</span>
              <span>{dinero(pedido.total)}</span>
            </div>
            {pedido.notaCliente && (
              <p className="border-t border-mayoreo-border pt-2 text-sm text-mayoreo-ink-soft">
                Tu nota: {pedido.notaCliente}
              </p>
            )}
          </section>

          {aviso && <p className={AVISO}>{aviso}</p>}

          <div className="flex flex-col gap-2">
            {pedido.modificable && (
              <Link
                href={`${base}/portal/pedidos/${encodeURIComponent(pedido.folio)}/modificar`}
                className={BTN_PRIMARIO + " block text-center"}
              >
                Modificar este pedido
              </Link>
            )}
            {pedido.esFavorito ? (
              <p className="text-center text-sm font-medium text-mayoreo-ink-soft">
                ★ Es tu pedido favorito
              </p>
            ) : (
              <button
                className={BTN_SECUNDARIO}
                disabled={guardando}
                onClick={() => void usarComoFavorito()}
              >
                {guardando ? "Guardando…" : "Usar este pedido como favorito"}
              </button>
            )}
            {sesion?.cliente && (
              <BotonWhatsApp
                numeroAtencion={numeroAtencion}
                contexto={{
                  tipo: "pedido",
                  cliente: sesion.cliente.nombre,
                  folios: [pedido.folio],
                }}
              />
            )}
          </div>
        </>
      )}
    </main>
  );
}
