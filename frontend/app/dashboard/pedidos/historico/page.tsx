"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  exportOrdersHistoricoCsv,
  fetchOrdersHistorico,
  METODO_PAGO_LABEL,
  type EstadoPedido,
  type MetodoPago,
  type PaginatedOrders,
} from "@/lib/api";
import { formatFechaHora, formatMoney } from "@/lib/format";
import {
  rangoHoyISO,
  rangoMesActualISO,
  rangoMesAnteriorISO,
  rangoUltimas4SemanasISO,
  rangoUltimos7DiasISO,
} from "@/lib/fecha";
import { ESTADO_LABEL, ESTADOS } from "../estado";
import Card from "../../_components/Card";
import Button from "../../_components/Button";
import Modal from "../../_components/Modal";
import Tabs from "../../_components/Tabs";

const LIMIT = 25;
const METODOS_PAGO: MetodoPago[] = ["EFECTIVO", "TRANSFERENCIA", "TARJETA"];

type RangoExport = "hoy" | "mes_actual" | "7_dias" | "4_semanas" | "mes_anterior" | "todas" | "personalizado";

const RANGO_EXPORT_OPTIONS: { value: RangoExport; label: string }[] = [
  { value: "hoy", label: "Hoy" },
  { value: "mes_actual", label: "Mes en curso" },
  { value: "7_dias", label: "Últimos 7 días" },
  { value: "4_semanas", label: "Últimas 4 semanas" },
  { value: "mes_anterior", label: "Mes anterior" },
  { value: "todas", label: "Todas" },
  { value: "personalizado", label: "Personalizado" },
];

export default function PedidosHistoricoPage() {
  const { token } = useSession();
  const [result, setResult] = useState<PaginatedOrders | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [estadoPedido, setEstadoPedido] = useState<EstadoPedido | "">("");
  const [metodoPago, setMetodoPago] = useState<MetodoPago | "">("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  const [exportOpen, setExportOpen] = useState(false);
  const [exportRango, setExportRango] = useState<RangoExport>("todas");
  const [exportDesde, setExportDesde] = useState("");
  const [exportHasta, setExportHasta] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const hayFiltrosActivos = Boolean(estadoPedido || metodoPago || desde || hasta);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchOrdersHistorico(token, {
      estadoPedido: estadoPedido || undefined,
      metodoPago: metodoPago || undefined,
      // "Hasta" se extiende al final del día (23:59:59.999) para que el
      // filtro sea inclusivo — mismo criterio que rangoHoyISO en lib/fecha.ts.
      desde: desde ? new Date(desde).toISOString() : undefined,
      hasta: hasta ? new Date(`${hasta}T23:59:59.999`).toISOString() : undefined,
      page,
      limit: LIMIT,
    })
      .then((res) => {
        if (!cancelled) setResult(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "No se pudo cargar el histórico de pedidos");
      });
    return () => {
      cancelled = true;
    };
  }, [token, page, estadoPedido, metodoPago, desde, hasta]);

  function handleFilterChange<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setPage(1);
  }

  function rangoParaExport(): { desde?: string; hasta?: string } {
    switch (exportRango) {
      case "hoy":
        return rangoHoyISO();
      case "mes_actual":
        return rangoMesActualISO();
      case "7_dias":
        return rangoUltimos7DiasISO();
      case "4_semanas":
        return rangoUltimas4SemanasISO();
      case "mes_anterior":
        return rangoMesAnteriorISO();
      case "personalizado":
        return {
          desde: exportDesde ? new Date(exportDesde).toISOString() : undefined,
          hasta: exportHasta ? new Date(`${exportHasta}T23:59:59.999`).toISOString() : undefined,
        };
      case "todas":
      default:
        return {};
    }
  }

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const { desde: rangoDesde, hasta: rangoHasta } = rangoParaExport();
      const blob = await exportOrdersHistoricoCsv(token, {
        estadoPedido: estadoPedido || undefined,
        metodoPago: metodoPago || undefined,
        desde: rangoDesde,
        hasta: rangoHasta,
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pedidos-historico.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setExportOpen(false);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : "No se pudo exportar el histórico");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Tabs items={[{ key: "historial", label: "Historial" }]} active="historial" onChange={() => {}} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
            Estatus
            <select
              value={estadoPedido}
              onChange={(e) => handleFilterChange(setEstadoPedido, e.target.value as EstadoPedido | "")}
              className="admin-input"
            >
              <option value="">Todos</option>
              {ESTADOS.map((estado) => (
                <option key={estado} value={estado}>
                  {ESTADO_LABEL[estado]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
            Método de pago
            <select
              value={metodoPago}
              onChange={(e) => handleFilterChange(setMetodoPago, e.target.value as MetodoPago | "")}
              className="admin-input"
            >
              <option value="">Todos</option>
              {METODOS_PAGO.map((metodo) => (
                <option key={metodo} value={metodo}>
                  {METODO_PAGO_LABEL[metodo]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
            Desde
            <input type="date" value={desde} onChange={(e) => handleFilterChange(setDesde, e.target.value)} className="admin-input" />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
            Hasta
            <input type="date" value={hasta} onChange={(e) => handleFilterChange(setHasta, e.target.value)} className="admin-input" />
          </label>
        </div>

        <Button variant="secondary" onClick={() => setExportOpen(true)}>
          📥 Exportar CSV
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result === null ? (
        <p className="text-sm text-admin-ink-soft">Cargando...</p>
      ) : result.data.length === 0 ? (
        <Card className="text-sm text-admin-ink-soft">
          {hayFiltrosActivos ? "No hay pedidos que coincidan con estos filtros." : "No hay pedidos en el histórico."}
        </Card>
      ) : (
        <>
          <Card padding={0} className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-admin-border text-admin-ink-soft">
                  <th className="px-4 py-3 font-bold">Folio</th>
                  <th className="px-4 py-3 font-bold">Cliente</th>
                  <th className="px-4 py-3 font-bold">Fecha</th>
                  <th className="px-4 py-3 font-bold">Estado</th>
                  <th className="px-4 py-3 font-bold">Método de pago</th>
                  <th className="px-4 py-3 text-right font-bold">Total</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((order) => (
                  <tr key={order.id} className="border-b border-admin-border last:border-b-0 hover:bg-admin-bg">
                    <td className="px-4 py-3 font-bold text-admin-ink">#{order.folio}</td>
                    <td className="px-4 py-3 text-admin-ink">{order.clienteNombre}</td>
                    <td className="px-4 py-3 text-admin-ink">{formatFechaHora(order.createdAt)}</td>
                    <td className="px-4 py-3 text-admin-ink">{ESTADO_LABEL[order.estadoPedido]}</td>
                    <td className="px-4 py-3 text-admin-ink">{METODO_PAGO_LABEL[order.metodoPago]}</td>
                    <td className="px-4 py-3 text-right text-admin-ink">{formatMoney(order.total)}</td>
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
              <Button variant="secondary" onClick={() => setPage((p) => p - 1)} disabled={result.page <= 1}>
                Anterior
              </Button>
              <Button variant="secondary" onClick={() => setPage((p) => p + 1)} disabled={result.page >= result.totalPages}>
                Siguiente
              </Button>
            </div>
          </div>
        </>
      )}

      <Modal
        open={exportOpen}
        onClose={() => {
          if (!exporting) setExportOpen(false);
        }}
        title="Exportar CSV"
        footer={
          <>
            <Button variant="secondary" onClick={() => setExportOpen(false)} disabled={exporting}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleExport} disabled={exporting}>
              {exporting ? "Exportando..." : "Exportar"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
            Rango de fecha
            <select
              value={exportRango}
              onChange={(e) => setExportRango(e.target.value as RangoExport)}
              className="admin-input"
            >
              {RANGO_EXPORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          {exportRango === "personalizado" && (
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1.5 text-sm font-semibold text-admin-ink">
                Desde
                <input
                  type="date"
                  value={exportDesde}
                  onChange={(e) => setExportDesde(e.target.value)}
                  className="admin-input"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1.5 text-sm font-semibold text-admin-ink">
                Hasta
                <input
                  type="date"
                  value={exportHasta}
                  onChange={(e) => setExportHasta(e.target.value)}
                  className="admin-input"
                />
              </label>
            </div>
          )}

          {exportError && <p className="text-sm text-red-600">{exportError}</p>}
        </div>
      </Modal>
    </div>
  );
}
