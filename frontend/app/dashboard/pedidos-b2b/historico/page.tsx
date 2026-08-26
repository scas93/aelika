"use client";

import { useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  exportPedidosB2bCsv,
  fetchPedidosB2b,
  type PaginatedPedidosB2b,
  type PedidoB2bEstado,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { ESTADO_LABEL } from "../estado";
import Card from "../../_components/Card";
import Button from "../../_components/Button";
import HistoricoDetallePanel from "./historico-detalle-panel";

const LIMIT = 25;
const ESTADOS_FILTRO: PedidoB2bEstado[] = ["PENDIENTE_CONFIRMACION", "CONFIRMADO_SURTIENDO", "DESPACHADO"];

function formatSemana(iso: string): string {
  // timeZone: "UTC" — semanaInicio es un @db.Date sin hora, ver el mismo
  // ajuste ya hecho en pedidos-b2b/page.tsx (formatFecha).
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function PedidosB2bHistoricoPage() {
  const { token } = useSession();

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [estado, setEstado] = useState<PedidoB2bEstado | "">("");
  const [negocioNombre, setNegocioNombre] = useState("");

  // Sin autofetch en cambios de filtro a propósito — no se muestra nada
  // hasta que se presiona "Buscar" (ver CLAUDE.md). `searched` es lo que
  // distingue "todavía no se buscó" de "se buscó y no hay resultados".
  const [searched, setSearched] = useState(false);
  const [result, setResult] = useState<PaginatedPedidosB2b | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  function filtrosActuales() {
    return {
      desde: desde || undefined,
      hasta: hasta || undefined,
      estado: estado || undefined,
      negocioNombre: negocioNombre.trim() || undefined,
    };
  }

  async function ejecutarBusqueda(pagina: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPedidosB2b(token, { ...filtrosActuales(), page: pagina, limit: LIMIT });
      setResult(res);
      setSearched(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo buscar el histórico de pedidos");
    } finally {
      setLoading(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await exportPedidosB2bCsv(token, filtrosActuales());
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pedidos-b2b-historico.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : "No se pudo exportar el histórico");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Desde
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="admin-input" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Hasta
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="admin-input" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Estatus
          <select
            value={estado}
            onChange={(e) => setEstado(e.target.value as PedidoB2bEstado | "")}
            className="admin-input"
          >
            <option value="">Todos</option>
            {ESTADOS_FILTRO.map((e) => (
              <option key={e} value={e}>
                {ESTADO_LABEL[e]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Negocio
          <input
            value={negocioNombre}
            onChange={(e) => setNegocioNombre(e.target.value)}
            placeholder="Buscar por negocio..."
            className="admin-input"
          />
        </label>
        <Button variant="primary" onClick={() => ejecutarBusqueda(1)} disabled={loading}>
          {loading ? "Buscando..." : "Buscar"}
        </Button>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {searched && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-sm text-admin-ink-soft">{result?.total ?? 0} pedidos encontrados</span>
            <Button
              variant="secondary"
              onClick={handleExport}
              disabled={exporting || !result || result.total === 0}
            >
              {exporting ? "Exportando..." : "📥 Exportar Excel"}
            </Button>
          </div>
          {exportError && <p className="text-sm text-red-600">{exportError}</p>}

          {result && result.data.length === 0 ? (
            <Card className="text-sm text-admin-ink-soft">No hay pedidos que coincidan con estos filtros.</Card>
          ) : (
            result && (
              <>
                <Card padding={0} className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-admin-border text-admin-ink-soft">
                        <th className="px-4 py-3 font-bold">Folio</th>
                        <th className="px-4 py-3 font-bold">Negocio</th>
                        <th className="px-4 py-3 font-bold">Semana</th>
                        <th className="px-4 py-3 font-bold">Estatus</th>
                        <th className="px-4 py-3 text-right font-bold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.data.map((pedido) => (
                        <tr
                          key={pedido.id}
                          onClick={() => setSelectedId(pedido.id)}
                          className="cursor-pointer border-b border-admin-border last:border-b-0 hover:bg-admin-bg"
                        >
                          <td className="px-4 py-3 font-bold text-admin-ink">#{pedido.folio}</td>
                          <td className="px-4 py-3 text-admin-ink">{pedido.negocioNombre}</td>
                          <td className="px-4 py-3 text-admin-ink">{formatSemana(pedido.semanaInicio)}</td>
                          <td className="px-4 py-3 text-admin-ink">
                            {pedido.cancelado ? "Cancelado" : ESTADO_LABEL[pedido.estado]}
                          </td>
                          <td className="px-4 py-3 text-right text-admin-ink">{formatMoney(pedido.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-admin-ink-soft">
                    Página {result.page} de {result.totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => ejecutarBusqueda(result.page - 1)}
                      disabled={loading || result.page <= 1}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => ejecutarBusqueda(result.page + 1)}
                      disabled={loading || result.page >= result.totalPages}
                    >
                      Siguiente
                    </Button>
                  </div>
                </div>
              </>
            )
          )}
        </>
      )}

      <HistoricoDetallePanel pedidoId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
