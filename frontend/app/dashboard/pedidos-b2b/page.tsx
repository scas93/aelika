"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, exportPedidosB2bCsv, fetchPedidosB2b, type PedidoB2bReportable } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { ESTADO_COLOR, ESTADO_LABEL, ESTADOS_ACTIVOS } from "./estado";
import Card from "../_components/Card";
import Button from "../_components/Button";
import Badge from "../_components/Badge";
import DetallePanel from "./detalle-panel";

// Sin paginación a propósito, mismo criterio que la pestaña "Activos" de
// /dashboard/pedidos (Order): el backend no soporta "estado distinto de X"
// en el listado, así que se piden todos y se filtra en el cliente. 100 es el
// máximo que acepta ListPedidosB2bQueryDto.limit (@Max(100)).
const LIMIT = 100;

// timeZone: "UTC" a propósito — semanaInicio es un @db.Date sin hora
// (medianoche UTC), formatearlo en la zona horaria local del navegador
// puede recorrerlo un día hacia atrás (ej. en UTC-6, "2026-08-31T00:00:00Z"
// cae en "30 de agosto" si no se fija a UTC).
function formatFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function PedidosB2bPage() {
  const { token } = useSession();
  const [pedidos, setPedidos] = useState<PedidoB2bReportable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function load() {
    try {
      const result = await fetchPedidosB2b(token, { limit: LIMIT });
      // El backend no soporta "estado distinto de" en un solo filtro — se
      // piden todas las páginas relevantes y se excluyen despachados/
      // cancelados en el cliente, mismo patrón que Order/Activos.
      setPedidos(result.data.filter((p) => !p.cancelado && ESTADOS_ACTIVOS.includes(p.estado)));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los pedidos");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtrados = useMemo(() => {
    if (!pedidos) return null;
    const q = busqueda.trim().toLowerCase();
    if (!q) return pedidos;
    return pedidos.filter((p) => p.negocioNombre.toLowerCase().includes(q));
  }, [pedidos, busqueda]);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await exportPedidosB2bCsv(token, { estados: ESTADOS_ACTIVOS, cancelado: false });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pedidos-b2b-activos.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : "No se pudo exportar los pedidos");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por negocio..."
          className="admin-input w-full max-w-xs"
        />
        <Button variant="secondary" onClick={handleExport} disabled={exporting}>
          {exporting ? "Exportando..." : "📥 Exportar Excel"}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {exportError && <p className="text-sm text-red-600">{exportError}</p>}

      {filtrados === null ? (
        <p className="text-sm text-admin-ink-soft">Cargando...</p>
      ) : filtrados.length === 0 ? (
        <Card className="text-sm text-admin-ink-soft">
          {busqueda ? "No hay pedidos activos que coincidan con esa búsqueda." : "No hay pedidos activos."}
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtrados.map((pedido) => (
            <li key={pedido.id}>
              <button type="button" onClick={() => setSelectedId(pedido.id)} className="block w-full text-left">
                <Card padding={20} className="transition hover:border-mayoreo-accent">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-admin-ink">#{pedido.folio}</span>
                        <span className="text-sm font-semibold text-admin-ink">{pedido.negocioNombre}</span>
                      </div>
                      <span className="text-sm text-admin-ink-soft">
                        {pedido.totalPiezas} piezas · Semana del {formatFecha(pedido.semanaInicio)}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge color={ESTADO_COLOR[pedido.estado]}>{ESTADO_LABEL[pedido.estado]}</Badge>
                      <span className="text-sm font-bold text-admin-ink">{formatMoney(pedido.total)}</span>
                    </div>
                  </div>
                </Card>
              </button>
            </li>
          ))}
        </ul>
      )}

      <DetallePanel pedidoId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />
    </div>
  );
}
