"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  exportPaymentsCsv,
  fetchPayments,
  type EstadoPago,
  type FiltroImporte,
  type PaginatedPayments,
  type Payment,
} from "@/lib/api";
import { formatFechaHora, formatMoney } from "@/lib/format";
import {
  rangoHoyISO,
  rangoMesActualISO,
  rangoMesAnteriorISO,
  rangoUltimas4SemanasISO,
  rangoUltimos7DiasISO,
} from "@/lib/fecha";
import { ESTADO_PAGO_VARIANT } from "../pedidos/estado";
import Card from "../_components/Card";
import Button from "../_components/Button";
import Modal from "../_components/Modal";
import Badge from "../_components/Badge";
import Table, { type TableColumn } from "../_components/Table";
import { FilterBar, FilterPill } from "../_components/FilterBar";
import { FiltroSelectPopover } from "../_components/FiltroSelect";
import { FiltroFechaPopover, labelFiltroFecha, resolverFiltroFecha, type FiltroFechaValue } from "../_components/FiltroFecha";
import { FiltroImportePopover, labelFiltroImporte } from "../_components/FiltroImporteControl";

const LIMIT = 25;

type RangoExport =
  | "hoy"
  | "mes_actual"
  | "7_dias"
  | "4_semanas"
  | "mes_anterior"
  | "todas"
  | "personalizado";

const RANGO_EXPORT_OPTIONS: { value: RangoExport; label: string }[] = [
  { value: "hoy", label: "Hoy" },
  { value: "mes_actual", label: "Mes en curso" },
  { value: "7_dias", label: "Últimos 7 días" },
  { value: "4_semanas", label: "Últimas 4 semanas" },
  { value: "mes_anterior", label: "Mes anterior" },
  { value: "todas", label: "Todas" },
  { value: "personalizado", label: "Personalizado" },
];

// No mapeo existente de EstadoPago a label en español en ningún otro lado
// del proyecto todavía (Order.estadoPago nunca se mostró en UI antes de
// este módulo) — a diferencia de ESTADO_LABEL en pedidos/estado.ts, que sí
// se reutiliza aquí no habría nada que reutilizar.
const ESTADO_PAGO_LABEL: Record<EstadoPago, string> = {
  PENDIENTE: "Pendiente",
  // Tampoco ocurre en una fila de Payment hoy (ver nota de REEMBOLSADO abajo)
  // — el webhook solo crea el Payment al recibir succeeded/payment_failed,
  // nunca en processing (ver StripeWebhookController) — pero Record debe
  // seguir siendo exhaustivo.
  PROCESANDO: "Procesando",
  PAGADO: "Pagado",
  FALLIDO: "Fallido",
  // Doesn't actually occur on a Payment row today — refunds (v1) update
  // Order.estadoPago directly and never touch Payment (see
  // OrdersService.reembolsar) — but Record<EstadoPago, string> must stay
  // exhaustive since Payment.status reuses the same enum.
  REEMBOLSADO: "Reembolsado",
};

// PENDIENTE nunca aplica a una fila de Payment (ver comentario en el schema
// de Payment.status) — se omite del filtro a propósito, esa opción siempre
// devolvería vacío.
const ESTADOS_PAGO_FILTRABLES: EstadoPago[] = ["PAGADO", "FALLIDO"];

// paymentMethodType es un string libre de Stripe con un solo valor real
// posible hoy ("card") — el select solo lo lista a él, pero se mantiene
// (en vez de omitirse) por consistencia visual con Método de pago en
// Pedidos > Histórico.
const METODOS_PAGO_FILTRABLES = ["card"];

const COLUMNS: TableColumn<Payment>[] = [
  { key: "folio", header: "Folio", render: (payment) => <span className="font-bold">#{payment.folio}</span> },
  { key: "monto", header: "Monto", align: "right", render: (payment) => formatMoney(payment.amount) },
  { key: "moneda", header: "Moneda", render: (payment) => payment.currency.toUpperCase() },
  {
    key: "estado",
    header: "Estado",
    render: (payment) => (
      <Badge variant={ESTADO_PAGO_VARIANT[payment.status]}>{ESTADO_PAGO_LABEL[payment.status]}</Badge>
    ),
  },
  {
    key: "metodo",
    header: "Método",
    render: (payment) =>
      payment.paymentMethodType
        ? payment.paymentMethodType.charAt(0).toUpperCase() + payment.paymentMethodType.slice(1)
        : "—",
  },
  {
    key: "fechaCaptura",
    header: "Fecha de captura",
    render: (payment) => (payment.capturedAt ? formatFechaHora(payment.capturedAt) : "—"),
  },
];

export default function PagosPage() {
  const { token } = useSession();
  const [result, setResult] = useState<PaginatedPayments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<EstadoPago | null>(null);
  const [paymentMethodType, setPaymentMethodType] = useState<string | null>(null);
  const [fecha, setFecha] = useState<FiltroFechaValue | null>(null);
  const [importe, setImporte] = useState<FiltroImporte | null>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportRango, setExportRango] = useState<RangoExport>("todas");
  const [exportDesde, setExportDesde] = useState("");
  const [exportHasta, setExportHasta] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { desde, hasta } = resolverFiltroFecha(fecha);
  const hayFiltrosActivos = Boolean(status || paymentMethodType || desde || hasta || importe);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchPayments(token, {
      status: status ?? undefined,
      paymentMethodType: paymentMethodType ?? undefined,
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
        if (!cancelled)
          setError(
            err instanceof ApiError
              ? err.message
              : "No se pudo cargar el listado de pagos",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [token, page, status, paymentMethodType, desde, hasta, importe]);

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
          hasta: exportHasta
            ? new Date(`${exportHasta}T23:59:59.999`).toISOString()
            : undefined,
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
      const blob = await exportPaymentsCsv(token, {
        status: status || undefined,
        paymentMethodType: paymentMethodType || undefined,
        desde: rangoDesde,
        hasta: rangoHasta,
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "pagos.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setExportOpen(false);
    } catch (err) {
      setExportError(
        err instanceof ApiError ? err.message : "No se pudo exportar los pagos",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar>
          <FilterPill
            filterKey="estado"
            label="Estado"
            valueLabel={status ? ESTADO_PAGO_LABEL[status] : null}
            onClear={() => handleFilterChange(setStatus, null)}
          >
            {({ close }) => (
              // Solo PAGADO/FALLIDO a propósito (ver ESTADOS_PAGO_FILTRABLES) —
              // los otros 3 valores de EstadoPago nunca ocurren en una fila de
              // Payment real, mostrarlos rompería el filtro en silencio.
              <FiltroSelectPopover
                opciones={ESTADOS_PAGO_FILTRABLES.map((estado) => ({ value: estado, label: ESTADO_PAGO_LABEL[estado] }))}
                valorAplicado={status}
                onAplicar={(value) => handleFilterChange(setStatus, value)}
                close={close}
              />
            )}
          </FilterPill>

          <FilterPill
            filterKey="metodoPago"
            label="Método de pago"
            valueLabel={paymentMethodType ? paymentMethodType.charAt(0).toUpperCase() + paymentMethodType.slice(1) : null}
            onClear={() => handleFilterChange(setPaymentMethodType, null)}
          >
            {({ close }) => (
              <FiltroSelectPopover
                opciones={METODOS_PAGO_FILTRABLES.map((metodo) => ({
                  value: metodo,
                  label: metodo.charAt(0).toUpperCase() + metodo.slice(1),
                }))}
                valorAplicado={paymentMethodType}
                onAplicar={(value) => handleFilterChange(setPaymentMethodType, value)}
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
            label="Monto"
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
          {hayFiltrosActivos
            ? "No hay pagos que coincidan con estos filtros."
            : "No hay pagos registrados."}
        </Card>
      ) : (
        <Table
          columns={COLUMNS}
          data={result.data}
          rowKey={(payment) => payment.id}
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
            <Button
              variant="secondary"
              onClick={() => setExportOpen(false)}
              disabled={exporting}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              onClick={handleExport}
              disabled={exporting}
            >
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
