"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  exportPedidosB2bXlsx,
  fetchPedidosB2b,
  type FiltroImporte,
  type PaginatedPedidosB2b,
  type PedidoB2bEstadoPago,
  type PedidoB2bReportable,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";
import {
  ESTADO_LABEL,
  ESTADO_VARIANT,
  ESTADO_FILTRO_LABEL,
  ESTADOS_FILTRO_HISTORICO,
  ESTADOS_PAGO_FILTRO,
  ESTADO_PAGO_LABEL,
  ESTADO_PAGO_VARIANT,
  type EstadoFiltroHistorico,
} from "../estado";
import Card from "../../_components/Card";
import Badge from "../../_components/Badge";
import Table, { type TableColumn } from "../../_components/Table";
import BarraBusqueda from "../../_components/BarraFiltros";
import { IconDownload } from "@tabler/icons-react";
import { FiltroMultiSelectPopover, labelMultiSelect } from "../../_components/FiltroMultiSelect";
import { FiltroFechaPopover, labelFiltroFecha, resolverFiltroSemana, type FiltroFechaValue } from "../../_components/FiltroFecha";
import { FiltroImportePopover, labelFiltroImporte } from "../../_components/FiltroImporteControl";
import HistoricoDetallePanel from "./historico-detalle-panel";
import { hoyYYYYMMDD } from "@/lib/fecha";

const LIMIT = 25;

function formatSemana(iso: string): string {
  // timeZone: "UTC" — semanaInicio es un @db.Date sin hora, ver el mismo
  // ajuste ya hecho en pedidos-b2b/page.tsx (formatFecha).
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Mismo patrón que historico-detalle-panel.tsx: cancelado gana sobre el
// estado real cuando aplica — no hay variante "cancelado" en ESTADO_VARIANT,
// se resuelve aquí igual que ahí (peligro).
const COLUMNS: TableColumn<PedidoB2bReportable>[] = [
  { key: "negocio", header: "Negocio", truncate: true, movil: true, render: (pedido) => <span className="block truncate font-bold">{pedido.negocioNombre}</span> },
  // nowrap: la semana nunca se parte en dos líneas.
  { key: "semana", header: "Semana", render: (pedido) => <span className="whitespace-nowrap">{formatSemana(pedido.semanaInicio)}</span> },
  {
    key: "estado",
    header: "Estado",
    render: (pedido) =>
      pedido.cancelado ? (
        <Badge variant="peligro" ancho="pedidoB2b">Cancelado</Badge>
      ) : (
        <Badge variant={ESTADO_VARIANT[pedido.estado]} ancho="pedidoB2b">{ESTADO_LABEL[pedido.estado]}</Badge>
      ),
  },
  {
    key: "pago",
    header: "Pago",
    // Un cancelado sin nada por cobrar no tiene pago que mostrar.
    render: (pedido) =>
      pedido.cancelado && Number(pedido.total) === 0 ? (
        <span className="text-admin-ink-soft">—</span>
      ) : (
        <Badge variant={ESTADO_PAGO_VARIANT[pedido.estadoPago]} ancho="pagoB2b">{ESTADO_PAGO_LABEL[pedido.estadoPago]}</Badge>
      ),
  },
  { key: "total", header: "Total", align: "right", movil: true, render: (pedido) => <span className="whitespace-nowrap">{formatMoney(pedido.total)}</span> },
];

export default function PedidosB2bHistoricoPage() {
  const { token } = useSession();

  const [fecha, setFecha] = useState<FiltroFechaValue | null>(null);
  // Estado y Pago son de selección múltiple (O dentro del filtro, Y entre filtros); vacío = todos.
  const [estado, setEstado] = useState<EstadoFiltroHistorico[]>([]);
  const [estadoPago, setEstadoPago] = useState<PedidoB2bEstadoPago[]>([]);
  // Buscador de texto (la barra espera un momento al teclear antes de avisar).
  const [negocioNombre, setNegocioNombre] = useState<string | null>(null);
  const [importe, setImporte] = useState<FiltroImporte | null>(null);

  // El histórico se carga solo al abrir la página (sin filtros: TODOS los pedidos, activos incluidos, semana más reciente primero) y
  // cada cambio de filtro vuelve a consultar desde la página 1 — los filtros refinan esa lista, no son requisito para verla. El
  // filtrado lo hace el servidor porque la lista es paginada. Quitar todos los filtros devuelve la lista inicial.
  const [result, setResult] = useState<PaginatedPedidosB2b | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // `?pedido=<id>` abre ese pedido directo (enlaces desde Adopción).
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("pedido"),
  );

  function filtrosActuales() {
    const { desde, hasta } = resolverFiltroSemana(fecha);
    // Marcar todas las opciones equivale a no marcar ninguna (el control sí conserva lo marcado).
    const estadosSel = estado.length === ESTADOS_FILTRO_HISTORICO.length ? [] : estado;
    const pagosSel = estadoPago.length === ESTADOS_PAGO_FILTRO.length ? [] : estadoPago;
    // "Cancelado" es el indicador `cancelado`, no un valor de estado: incluye los cancelados en cualquier estado, y los demás
    // estados marcados solo los no cancelados.
    const conCancelado = estadosSel.includes("CANCELADO");
    const estados = estadosSel.filter((e): e is Exclude<EstadoFiltroHistorico, "CANCELADO"> => e !== "CANCELADO");
    return {
      desde,
      hasta,
      estados: estados.length > 0 ? estados : undefined,
      conCancelados: conCancelado && estados.length > 0 ? true : undefined,
      negocioNombre: negocioNombre?.trim() || undefined,
      estadoPago: pagosSel.length > 0 ? pagosSel : undefined,
      // Solo Cancelado: `cancelado=true`; solo otros estados: `cancelado=false` (como siempre); mezcla: lo resuelve `conCancelados`.
      cancelado: conCancelado ? (estados.length > 0 ? undefined : true) : estados.length > 0 ? false : undefined,
      operador: importe?.operador,
      valor: importe?.valor,
      valorHasta: importe?.valorHasta,
    };
  }

  // Solo cuenta la respuesta de la consulta más reciente (cambiar de filtro rápido no deja que una respuesta vieja pise a la nueva).
  const ultimaConsulta = useRef(0);

  async function ejecutarBusqueda(pagina: number) {
    const consulta = ++ultimaConsulta.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPedidosB2b(token, { ...filtrosActuales(), page: pagina, limit: LIMIT });
      if (consulta === ultimaConsulta.current) setResult(res);
    } catch (err) {
      if (consulta === ultimaConsulta.current) setError(err instanceof ApiError ? err.message : "No se pudo cargar el histórico de pedidos");
    } finally {
      if (consulta === ultimaConsulta.current) setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y recarga al cambiar un filtro
    void ejecutarBusqueda(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, estado, estadoPago, negocioNombre, importe]);

  const hayFiltros = !!(fecha || estado.length > 0 || estadoPago.length > 0 || negocioNombre || importe);

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      // `vista` elige las columnas del Excel de Históricos (sin ella el endpoint entrega las de Pedidos activos).
      const blob = await exportPedidosB2bXlsx(token, { ...filtrosActuales(), vista: "HISTORICOS" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `historico-${hoyYYYYMMDD()}.xlsx`;
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
    <div className="flex flex-col gap-3">
      {/* Una sola barra: buscador + «Filtros» (Estado, Pago, Semana, Total). Los filtros aplican al elegir. */}
      <BarraBusqueda
        placeholder="Buscar negocio…"
        acciones={[{ key: "exportar", label: "Exportar Excel", icon: <IconDownload size={16} />, tipo: "exportar", onClick: handleExport, disabled: !result || result.total === 0, cargando: exporting }]}
        onBuscar={(texto) => setNegocioNombre(texto || null)}
        filtros={[
          {
            key: "estado",
            label: "Estado",
            valueLabel: labelMultiSelect(estado, (e) => ESTADO_FILTRO_LABEL[e]),
            onClear: () => setEstado([]),
            render: () => (
              <FiltroMultiSelectPopover
                opciones={ESTADOS_FILTRO_HISTORICO.map((e) => ({ value: e, label: ESTADO_FILTRO_LABEL[e] }))}
                valoresAplicados={estado}
                onAplicar={setEstado}
              />
            ),
          },
          {
            key: "estadoPago",
            label: "Pago",
            valueLabel: labelMultiSelect(estadoPago, (e) => ESTADO_PAGO_LABEL[e]),
            onClear: () => setEstadoPago([]),
            render: () => (
              <FiltroMultiSelectPopover
                opciones={ESTADOS_PAGO_FILTRO.map((e) => ({ value: e, label: ESTADO_PAGO_LABEL[e] }))}
                valoresAplicados={estadoPago}
                onAplicar={setEstadoPago}
              />
            ),
          },
          {
            key: "fecha",
            label: "Semana",
            valueLabel: labelFiltroFecha(fecha),
            onClear: () => setFecha(null),
            render: ({ cerrar }) => <FiltroFechaPopover modo="semana" valorAplicado={fecha} onAplicar={setFecha} close={cerrar} />,
          },
          {
            key: "importe",
            label: "Total",
            valueLabel: labelFiltroImporte(importe),
            onClear: () => setImporte(null),
            render: ({ cerrar }) => <FiltroImportePopover valorAplicado={importe} onAplicar={setImporte} close={cerrar} />,
          },
        ]}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result === null && !error && <p className="text-sm text-admin-ink-soft">Cargando...</p>}

      {result && (
        <>
          {exportError && <p className="text-sm text-red-600">{exportError}</p>}

          {result.data.length === 0 ? (
            <Card className="text-sm text-admin-ink-soft">
              {hayFiltros ? "No hay pedidos que coincidan con estos filtros." : "Aún no hay pedidos."}
            </Card>
          ) : (
            <Table
              columns={COLUMNS}
              data={result.data}
              rowKey={(pedido) => pedido.id}
              onRowClick={(pedido) => setSelectedId(pedido.id)}
              pagination={{
                page: result.page,
                totalPages: result.totalPages,
                total: result.total,
                limit: LIMIT,
                onPrevious: () => ejecutarBusqueda(result.page - 1),
                onNext: () => ejecutarBusqueda(result.page + 1),
                disabled: loading,
              }}
            />
          )}
        </>
      )}

      {/* Tras editar, corregir o cambiar el pago, la lista se vuelve a consultar (un Completado que recibe una entrega vuelve a
          En proceso). El panel conserva el pedido abierto con su estado nuevo. */}
      <HistoricoDetallePanel
        pedidoId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => {
          void ejecutarBusqueda(result?.page ?? 1);
        }}
      />
    </div>
  );
}
