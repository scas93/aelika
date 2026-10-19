"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  fetchEntregasPedidoClienteB2b,
  fetchPedidosClienteB2b,
  type ClienteB2bEntregaHistorial,
  type ClienteB2bPedidoFila,
} from "@/lib/api";
import { formatearFolioB2b, formatMoney } from "@/lib/format";
import Badge from "../_components/Badge";
import Button from "../_components/Button";
import EntregasLista from "../pedidos-b2b/entregas-lista";
import { entregasDesdeHistorial } from "../pedidos-b2b/entregas-vista";
import {
  ESTADO_LABEL,
  ESTADO_PAGO_LABEL,
  ESTADO_PAGO_VARIANT,
  ESTADO_VARIANT,
} from "../pedidos-b2b/estado";

const LIMIT = 20;

// `fecha` y `semanaInicio` son @db.Date (medianoche UTC): en la zona local del navegador podrían caer un día antes.
const fechaUtc = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleDateString("es-MX", { ...opts, timeZone: "UTC" });

function EntregasDelPedido({ clienteId, pedidoId }: { clienteId: string; pedidoId: string }) {
  const { token } = useSession();
  const [entregas, setEntregas] = useState<ClienteB2bEntregaHistorial[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchEntregasPedidoClienteB2b(token, clienteId, pedidoId)
      .then((r) => {
        if (!cancelled) setEntregas(r.entregas);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "No se pudieron cargar las entregas");
      });
    return () => {
      cancelled = true;
    };
  }, [token, clienteId, pedidoId]);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!entregas) return <p className="text-xs text-admin-ink-soft">Cargando entregas...</p>;
  // Mismo bloque que el panel del pedido, sin acciones (ni «Editar pedido»).
  return <EntregasLista entregas={entregasDesdeHistorial(entregas)} />;
}

/** Historial de solo lectura del cliente: todos sus pedidos (semana más reciente primero) y, al expandir uno, sus entregas. */
export default function HistorialPedidosCliente({ clienteId }: { clienteId: string }) {
  const { token } = useSession();
  const [pedidos, setPedidos] = useState<ClienteB2bPedidoFila[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);

  const cargar = useCallback(
    async (siguiente: number) => {
      setCargando(true);
      setError(null);
      try {
        const r = await fetchPedidosClienteB2b(token, clienteId, siguiente, LIMIT);
        setPedidos((prev) => (siguiente === 1 ? r.data : [...(prev ?? []), ...r.data]));
        setTotal(r.total);
        setPage(r.page);
        setTotalPages(r.totalPages);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial de pedidos");
      } finally {
        setCargando(false);
      }
    },
    [token, clienteId],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial al abrir el cliente
    cargar(1);
  }, [cargar]);

  return (
    <div className="flex flex-col gap-3 border-t border-admin-border pt-4">
      <h3 className="text-sm font-bold text-admin-ink">Pedidos{pedidos ? ` (${total})` : ""}</h3>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {!pedidos && !error && <p className="text-xs text-admin-ink-soft">Cargando pedidos...</p>}
      {pedidos && pedidos.length === 0 && <p className="text-xs text-admin-ink-soft">Este cliente todavía no tiene pedidos.</p>}

      {pedidos?.map((p) => {
        const expandido = abierto === p.id;
        return (
          <div key={p.id} className="flex flex-col gap-2 rounded-[var(--radius-admin-control)] border border-admin-border p-3">
            <button
              type="button"
              onClick={() => setAbierto(expandido ? null : p.id)}
              aria-expanded={expandido}
              className="flex w-full flex-col gap-1.5 text-left"
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold text-admin-ink">
                  {formatearFolioB2b(p.folio)}
                  {p.semanaInicio && (
                    <span className="ml-2 font-normal text-admin-ink-soft">
                      Semana del {fechaUtc(p.semanaInicio, { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  )}
                </span>
                <span className="text-xs text-admin-ink-soft">{expandido ? "▼" : "▶"}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {p.cancelado ? <Badge variant="peligro">Cancelado</Badge> : <Badge variant={ESTADO_VARIANT[p.estado]}>{ESTADO_LABEL[p.estado]}</Badge>}
                <Badge variant={ESTADO_PAGO_VARIANT[p.estadoPago]}>{ESTADO_PAGO_LABEL[p.estadoPago]}</Badge>
                <span className="text-xs text-admin-ink-soft">
                  {p.totalPiezas} pza{p.totalPiezas === 1 ? "" : "s"} · {formatMoney(p.total)}
                </span>
              </span>
            </button>
            {expandido && <EntregasDelPedido clienteId={clienteId} pedidoId={p.id} />}
          </div>
        );
      })}

      {pedidos && page < totalPages && (
        <div>
          <Button variant="secondary" size="sm" onClick={() => cargar(page + 1)} disabled={cargando}>
            {cargando ? "Cargando..." : "Cargar más"}
          </Button>
        </div>
      )}
    </div>
  );
}
