"use client";

import { useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  exportPedidosB2bCsv,
  fetchPedidosB2b,
  type FiltroImporte,
  type PaginatedPedidosB2b,
  type PedidoB2bEstado,
  type PedidoB2bReportable,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { ESTADO_LABEL, ESTADO_VARIANT } from "../estado";
import Card from "../../_components/Card";
import Button from "../../_components/Button";
import Badge from "../../_components/Badge";
import Table, { type TableColumn } from "../../_components/Table";
import { FilterBar, FilterPill } from "../../_components/FilterBar";
import { FiltroSelectPopover } from "../../_components/FiltroSelect";
import { FiltroFechaPopover, labelFiltroFecha, resolverFiltroFecha, type FiltroFechaValue } from "../../_components/FiltroFecha";
import { FiltroImportePopover, labelFiltroImporte } from "../../_components/FiltroImporteControl";
import HistoricoDetallePanel from "./historico-detalle-panel";

const LIMIT = 25;
const ESTADOS_FILTRO: PedidoB2bEstado[] = ["PENDIENTE_CONFIRMACION", "CONFIRMADO_SURTIENDO", "DESPACHADO"];

function formatSemana(iso: string): string {
  // timeZone: "UTC" — semanaInicio es un @db.Date sin hora, ver el mismo
  // ajuste ya hecho en pedidos-b2b/page.tsx (formatFecha).
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Mismo patrón que historico-detalle-panel.tsx: cancelado gana sobre el
// estado real cuando aplica — no hay variante "cancelado" en ESTADO_VARIANT,
// se resuelve aquí igual que ahí (peligro).
const COLUMNS: TableColumn<PedidoB2bReportable>[] = [
  { key: "folio", header: "Folio", render: (pedido) => <span className="font-bold">#{pedido.folio}</span> },
  { key: "negocio", header: "Negocio", render: (pedido) => pedido.negocioNombre },
  { key: "semana", header: "Semana", render: (pedido) => formatSemana(pedido.semanaInicio) },
  {
    key: "estatus",
    header: "Estatus",
    render: (pedido) =>
      pedido.cancelado ? (
        <Badge variant="peligro">Cancelado</Badge>
      ) : (
        <Badge variant={ESTADO_VARIANT[pedido.estado]}>{ESTADO_LABEL[pedido.estado]}</Badge>
      ),
  },
  { key: "total", header: "Total", align: "right", render: (pedido) => formatMoney(pedido.total) },
];

// Solo un consumidor (este módulo) — a diferencia de FiltroSelectPopover/
// FiltroFechaPopover/FiltroImportePopover, que sí viven en _components/
// porque las 3 tablas migradas los comparten tal cual, esto no se
// extrajo ahí.
function FiltroNegocioPopover({
  valorAplicado,
  onAplicar,
  close,
}: {
  valorAplicado: string | null;
  onAplicar: (value: string | null) => void;
  close: () => void;
}) {
  const [valor, setValor] = useState(valorAplicado ?? "");

  function handleAplicar() {
    onAplicar(valor.trim() || null);
    close();
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="Buscar por negocio..."
        className="admin-input"
      />
      <Button variant="primary" size="sm" onClick={handleAplicar} className="self-start">
        Aplicar
      </Button>
    </div>
  );
}

export default function PedidosB2bHistoricoPage() {
  const { token } = useSession();

  const [fecha, setFecha] = useState<FiltroFechaValue | null>(null);
  const [estado, setEstado] = useState<PedidoB2bEstado | null>(null);
  const [negocioNombre, setNegocioNombre] = useState<string | null>(null);
  const [cancelado, setCancelado] = useState<boolean | null>(null);
  const [importe, setImporte] = useState<FiltroImporte | null>(null);

  // Sin autofetch en cambios de filtro a propósito — no se muestra nada
  // hasta que se presiona "Buscar" (ver CLAUDE.md). `searched` es lo que
  // distingue "todavía no se buscó" de "se buscó y no hay resultados".
  //
  // A diferencia de pedidos/historico y pagos (donde "Aplicar" en el pill
  // ya dispara la consulta al backend, mismo criterio "autoaplica" que
  // tenían antes de migrar a FilterBar), aquí "Aplicar" solo actualiza el
  // valor mostrado en el pill — la consulta real sigue esperando al botón
  // "Buscar" de abajo, igual que hoy. Decisión explícita: se preserva el
  // comportamiento existente en vez de unificarlo con los otros dos, ya que
  // nada en el prompt pedía cambiarlo y esta pantalla ya distingue
  // "todavía no se buscó" de "se buscó y no hay resultados" (`searched`),
  // algo que dejaría de tener sentido si autoaplicara como las otras dos.
  const [searched, setSearched] = useState(false);
  const [result, setResult] = useState<PaginatedPedidosB2b | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  function filtrosActuales() {
    const { desde, hasta } = resolverFiltroFecha(fecha);
    return {
      desde,
      hasta,
      estado: estado ?? undefined,
      negocioNombre: negocioNombre?.trim() || undefined,
      cancelado: cancelado ?? undefined,
      operador: importe?.operador,
      valor: importe?.valor,
      valorHasta: importe?.valorHasta,
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
      <Card className="flex flex-wrap items-center gap-3">
        <FilterBar>
          <FilterPill
            filterKey="estado"
            label="Estado"
            valueLabel={estado ? ESTADO_LABEL[estado] : null}
            onClear={() => setEstado(null)}
          >
            {({ close }) => (
              <FiltroSelectPopover
                opciones={ESTADOS_FILTRO.map((e) => ({ value: e, label: ESTADO_LABEL[e] }))}
                valorAplicado={estado}
                onAplicar={setEstado}
                close={close}
              />
            )}
          </FilterPill>

          <FilterPill filterKey="fecha" label="Semana" valueLabel={labelFiltroFecha(fecha)} onClear={() => setFecha(null)}>
            {({ close }) => <FiltroFechaPopover valorAplicado={fecha} onAplicar={setFecha} close={close} />}
          </FilterPill>

          <FilterPill filterKey="importe" label="Total" valueLabel={labelFiltroImporte(importe)} onClear={() => setImporte(null)}>
            {({ close }) => <FiltroImportePopover valorAplicado={importe} onAplicar={setImporte} close={close} />}
          </FilterPill>

          <FilterPill filterKey="negocio" label="Negocio" valueLabel={negocioNombre?.trim() || null} onClear={() => setNegocioNombre(null)}>
            {({ close }) => <FiltroNegocioPopover valorAplicado={negocioNombre} onAplicar={setNegocioNombre} close={close} />}
          </FilterPill>

          <FilterPill
            filterKey="cancelado"
            label="Cancelado"
            valueLabel={cancelado === null ? null : cancelado ? "Sí" : "No"}
            onClear={() => setCancelado(null)}
          >
            {({ close }) => (
              <FiltroSelectPopover
                opciones={[
                  { value: "true", label: "Sí" },
                  { value: "false", label: "No" },
                ]}
                valorAplicado={cancelado === null ? null : String(cancelado)}
                onAplicar={(value) => setCancelado(value === null ? null : value === "true")}
                close={close}
              />
            )}
          </FilterPill>
        </FilterBar>

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
              <Table
                columns={COLUMNS}
                data={result.data}
                rowKey={(pedido) => pedido.id}
                onRowClick={(pedido) => setSelectedId(pedido.id)}
                pagination={{
                  page: result.page,
                  totalPages: result.totalPages,
                  onPrevious: () => ejecutarBusqueda(result.page - 1),
                  onNext: () => ejecutarBusqueda(result.page + 1),
                  disabled: loading,
                }}
              />
            )
          )}
        </>
      )}

      <HistoricoDetallePanel pedidoId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
