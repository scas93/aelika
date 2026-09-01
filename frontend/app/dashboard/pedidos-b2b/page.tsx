"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  exportPedidosB2bCsv,
  fetchPedidosB2b,
  fetchPedidosB2bResumen,
  type PedidoB2bReportable,
} from "@/lib/api";
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

interface SemanaInfo {
  inicio: string;
  fin: string;
}

type SemanaKey = "actual" | "siguiente";

export default function PedidosB2bPage() {
  const { token } = useSession();
  // "Semana actual"/"siguiente" vienen de GET /pedidos-b2b/resumen — el
  // backend ya es la fuente de verdad de a qué semana pertenece "hoy"
  // (resolverSemanaYDia) y cuál es la próxima (calcularSemanaDestino), mismo
  // cálculo que ya usa el resto del módulo B2B. Nunca se recalcula aquí.
  const [semanas, setSemanas] = useState<{ actual: SemanaInfo; siguiente: SemanaInfo } | null>(null);
  const [semanaError, setSemanaError] = useState<string | null>(null);
  const [semanaKey, setSemanaKey] = useState<SemanaKey>("actual");

  const [pedidos, setPedidos] = useState<PedidoB2bReportable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    fetchPedidosB2bResumen(token)
      .then((resumen) => {
        setSemanas({
          actual: { inicio: resumen.semanaEnCurso.inicio, fin: resumen.semanaEnCurso.fin },
          siguiente: { inicio: resumen.proximaSemana.inicio, fin: resumen.proximaSemana.fin },
        });
      })
      .catch((err) => setSemanaError(err instanceof ApiError ? err.message : "No se pudo determinar la semana actual"));
  }, [token]);

  const semanaSeleccionada = semanas?.[semanaKey] ?? null;

  // desde=hasta=semana.inicio → semanaInicio exacto (ver
  // PedidosB2bService.buildWhere: gte/lte sobre la misma fecha equivale a
  // igualdad en un campo @db.Date). El backend no soporta "estado distinto
  // de" en un solo filtro — se traen todos los relevantes y se excluyen
  // despachados/cancelados en el cliente, mismo patrón que Order/Activos.
  async function fetchSemana(semana: SemanaInfo): Promise<PedidoB2bReportable[]> {
    const result = await fetchPedidosB2b(token, { desde: semana.inicio, hasta: semana.inicio, limit: LIMIT });
    return result.data.filter((p) => !p.cancelado && ESTADOS_ACTIVOS.includes(p.estado));
  }

  useEffect(() => {
    if (!semanaSeleccionada) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets stale list before re-fetching whenever la semana seleccionada cambia
    setPedidos(null);
    setError(null);
    fetchSemana(semanaSeleccionada)
      .then((data) => {
        if (!cancelled) setPedidos(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "No se pudieron cargar los pedidos");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, semanaSeleccionada?.inicio]);

  function reload() {
    if (!semanaSeleccionada) return;
    fetchSemana(semanaSeleccionada)
      .then(setPedidos)
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar los pedidos"));
  }

  const filtrados = useMemo(() => {
    if (!pedidos) return null;
    const q = busqueda.trim().toLowerCase();
    if (!q) return pedidos;
    return pedidos.filter((p) => p.negocioNombre.toLowerCase().includes(q));
  }, [pedidos, busqueda]);

  async function handleExport() {
    if (!semanaSeleccionada) return;
    setExporting(true);
    setExportError(null);
    try {
      const blob = await exportPedidosB2bCsv(token, {
        estados: ESTADOS_ACTIVOS,
        cancelado: false,
        desde: semanaSeleccionada.inicio,
        hasta: semanaSeleccionada.inicio,
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pedidos-b2b-activos-${semanaSeleccionada.inicio}.csv`;
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
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSemanaKey("actual")}
            disabled={!semanas || semanaKey === "actual"}
            aria-label="Semana actual"
          >
            ←
          </Button>
          <span className="min-w-[160px] text-center text-base font-bold text-admin-ink">
            {semanaKey === "actual" ? "Semana en curso" : "Próxima semana"}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSemanaKey("siguiente")}
            disabled={!semanas || semanaKey === "siguiente"}
            aria-label="Semana siguiente"
          >
            →
          </Button>
        </div>

        <Button variant="secondary" onClick={handleExport} disabled={exporting || !pedidos}>
          {exporting ? "Exportando..." : "📥 Exportar Excel"}
        </Button>
      </div>

      <input
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="Buscar por negocio..."
        className="admin-input w-full"
      />

      {semanaError && <p className="text-sm text-red-600">{semanaError}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {exportError && <p className="text-sm text-red-600">{exportError}</p>}

      {filtrados === null ? (
        <p className="text-sm text-admin-ink-soft">Cargando...</p>
      ) : filtrados.length === 0 ? (
        <Card className="text-sm text-admin-ink-soft">
          {busqueda ? "No hay pedidos activos que coincidan con esa búsqueda." : "No hay pedidos activos para esta semana."}
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

      <DetallePanel pedidoId={selectedId} onClose={() => setSelectedId(null)} onChanged={reload} />
    </div>
  );
}
