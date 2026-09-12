"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  exportOrdersHistoricoCsv,
  fetchOrdersHistorico,
  METODO_PAGO_LABEL,
  type EstadoPedido,
  type FiltroImporte,
  type MetodoPago,
  type Order,
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
import { ESTADO_LABEL, ESTADO_VARIANT, ESTADOS } from "../estado";
import Card from "../../_components/Card";
import Button from "../../_components/Button";
import Modal from "../../_components/Modal";
import Tabs from "../../_components/Tabs";
import Badge from "../../_components/Badge";
import Table, { type TableColumn } from "../../_components/Table";
import { FilterBar, FilterPill } from "../../_components/FilterBar";
import { FiltroSelectPopover } from "../../_components/FiltroSelect";
import { FiltroFechaPopover, labelFiltroFecha, resolverFiltroFecha, type FiltroFechaValue } from "../../_components/FiltroFecha";
import { FiltroImportePopover, labelFiltroImporte } from "../../_components/FiltroImporteControl";

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

const COLUMNS: TableColumn<Order>[] = [
  { key: "folio", header: "Folio", render: (order) => <span className="font-bold">#{order.folio}</span> },
  { key: "cliente", header: "Cliente", render: (order) => order.clienteNombre },
  { key: "fecha", header: "Fecha", render: (order) => formatFechaHora(order.createdAt) },
  {
    key: "estado",
    header: "Estado",
    render: (order) => <Badge variant={ESTADO_VARIANT[order.estadoPedido]}>{ESTADO_LABEL[order.estadoPedido]}</Badge>,
  },
  { key: "metodoPago", header: "Método de pago", render: (order) => METODO_PAGO_LABEL[order.metodoPago] },
  { key: "total", header: "Total", align: "right", render: (order) => formatMoney(order.total) },
];

export default function PedidosHistoricoPage() {
  const { token } = useSession();
  const [result, setResult] = useState<PaginatedOrders | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [estadoPedido, setEstadoPedido] = useState<EstadoPedido | null>(null);
  const [metodoPago, setMetodoPago] = useState<MetodoPago | null>(null);
  const [fecha, setFecha] = useState<FiltroFechaValue | null>(null);
  const [importe, setImporte] = useState<FiltroImporte | null>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportRango, setExportRango] = useState<RangoExport>("todas");
  const [exportDesde, setExportDesde] = useState("");
  const [exportHasta, setExportHasta] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { desde, hasta } = resolverFiltroFecha(fecha);
  const hayFiltrosActivos = Boolean(estadoPedido || metodoPago || desde || hasta || importe);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchOrdersHistorico(token, {
      estadoPedido: estadoPedido ?? undefined,
      metodoPago: metodoPago ?? undefined,
      desde,
      hasta,
      operador: importe?.operador,
      valor: importe?.valor,
      valorHasta: importe?.valorHasta,
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
  }, [token, page, estadoPedido, metodoPago, desde, hasta, importe]);

  // Cada Aplicar de un pill llama esto — mismo criterio "autoaplica" que ya
  // tenía esta pantalla (cambiar un <select> disparaba la consulta de
  // inmediato), solo que ahora el cambio de estado ocurre al presionar
  // "Aplicar" dentro del popover en vez de al cambiar un <select> suelto.
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar>
          <FilterPill
            filterKey="estado"
            label="Estado"
            valueLabel={estadoPedido ? ESTADO_LABEL[estadoPedido] : null}
            onClear={() => handleFilterChange(setEstadoPedido, null)}
          >
            {({ close }) => (
              <FiltroSelectPopover
                opciones={ESTADOS.map((estado) => ({ value: estado, label: ESTADO_LABEL[estado] }))}
                valorAplicado={estadoPedido}
                onAplicar={(value) => handleFilterChange(setEstadoPedido, value)}
                close={close}
              />
            )}
          </FilterPill>

          <FilterPill
            filterKey="metodoPago"
            label="Método de pago"
            valueLabel={metodoPago ? METODO_PAGO_LABEL[metodoPago] : null}
            onClear={() => handleFilterChange(setMetodoPago, null)}
          >
            {({ close }) => (
              <FiltroSelectPopover
                opciones={METODOS_PAGO.map((metodo) => ({ value: metodo, label: METODO_PAGO_LABEL[metodo] }))}
                valorAplicado={metodoPago}
                onAplicar={(value) => handleFilterChange(setMetodoPago, value)}
                close={close}
              />
            )}
          </FilterPill>

          <FilterPill
            filterKey="fecha"
            label="Fecha"
            valueLabel={labelFiltroFecha(fecha)}
            onClear={() => handleFilterChange(setFecha, null)}
          >
            {({ close }) => (
              <FiltroFechaPopover valorAplicado={fecha} onAplicar={(value) => handleFilterChange(setFecha, value)} close={close} />
            )}
          </FilterPill>

          <FilterPill
            filterKey="importe"
            label="Total"
            valueLabel={labelFiltroImporte(importe)}
            onClear={() => handleFilterChange(setImporte, null)}
          >
            {({ close }) => (
              <FiltroImportePopover valorAplicado={importe} onAplicar={(value) => handleFilterChange(setImporte, value)} close={close} />
            )}
          </FilterPill>
        </FilterBar>

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
        <Table
          columns={COLUMNS}
          data={result.data}
          rowKey={(order) => order.id}
          pagination={{
            page: result.page,
            totalPages: result.totalPages,
            onPrevious: () => setPage((p) => p - 1),
            onNext: () => setPage((p) => p + 1),
          }}
        />
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
