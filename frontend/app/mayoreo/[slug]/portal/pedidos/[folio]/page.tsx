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
import { hora12, rangoSemanaCorto } from "@/lib/portal-calendario-formato";
import BotonWhatsApp from "../../boton-whatsapp";
import {
  AVISO,
  BTN_ENLACE,
  BTN_PRIMARIO,
  CARD,
  ERROR,
  WRAPPER,
} from "../../estilos";
import EncabezadoPantalla from "../../encabezado-pantalla";
import BarraAccionFija from "../../crear/barra-accion-fija";
import {
  BloqueRecoge,
  DiaEntrega,
  TarjetaTotal,
} from "../../crear/bloques-pedido";
import PedidoChips from "../pedido-chips";
import { useSesionPortal } from "../usar-sesion-portal";

// Detalle de un pedido (4e): total, estado, entregas por fecha con su estado y productos (solo cantidades), lugar y hora de
// recolección. Solo lectura; «Modificar pedido» va en la barra fija cuando el pedido se puede modificar.
export default function DetallePedidoPage() {
  const { slug, folio } = useParams<{ slug: string; folio: string }>();
  const { sesion, numeroAtencion, ubicacion, horaEntrega, base, router } =
    useSesionPortal(slug);
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
    <main className={WRAPPER}>
      <EncabezadoPantalla
        titulo={
          pedido
            ? `Semana ${rangoSemanaCorto(pedido.semanaInicio, pedido.semanaFin)}`
            : undefined
        }
        href={`${base}/portal/pedidos`}
      />

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
          <TarjetaTotal
            total={pedido.total}
            subtotal={pedido.subtotal}
            descuento={pedido.descuentoTotal}
            descuentoPorcentaje={pedido.descuentoPorcentaje}
          />
          <PedidoChips pedido={pedido} conFechaPago />

          <section className={CARD + " gap-3"}>
            <div className="flex flex-col gap-3">
              {pedido.entregas.map((e) => (
                <DiaEntrega
                  key={e.fecha}
                  fecha={e.fecha}
                  estado={e.estado}
                  lineas={e.productos.map((p) => ({
                    clave: p.nombre,
                    nombre: p.nombre,
                    cantidad: p.cantidad,
                  }))}
                />
              ))}
            </div>
            <BloqueRecoge
              direccion={ubicacion}
              hora={horaEntrega ? hora12(horaEntrega) : undefined}
              className="border-t border-mayoreo-border pt-3"
            />
          </section>

          {pedido.notaCliente && (
            <p className="text-sm text-mayoreo-ink-soft">
              Tu nota: {pedido.notaCliente}
            </p>
          )}

          {aviso && <p className={AVISO}>{aviso}</p>}

          <div className="flex flex-col items-start gap-3">
            {pedido.esFavorito ? (
              <p className="text-sm font-medium text-mayoreo-ink-soft">
                ★ Es tu pedido favorito
              </p>
            ) : (
              <button
                className={BTN_ENLACE}
                disabled={guardando}
                onClick={() => void usarComoFavorito()}
              >
                {guardando ? "Guardando…" : "Usar este pedido como favorito"}
              </button>
            )}
            {sesion?.cliente && (
              <BotonWhatsApp
                discreto
                numeroAtencion={numeroAtencion}
                contexto={{
                  tipo: "pedido",
                  cliente: sesion.cliente.nombre,
                  folios: [pedido.folio],
                }}
              />
            )}
          </div>

          {pedido.modificable && (
            <BarraAccionFija>
              <Link
                href={`${base}/portal/pedidos/${encodeURIComponent(pedido.folio)}/modificar?desde=detalle`}
                className={BTN_PRIMARIO + " block text-center"}
              >
                Modificar pedido
              </Link>
            </BarraAccionFija>
          )}
        </>
      )}
    </main>
  );
}
