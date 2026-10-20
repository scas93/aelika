"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  exportPedidosB2bXlsx,
  fetchPedidosB2b,
  fetchPedidosB2bResumen,
  type PedidoB2bReportable,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { ESTADO_VARIANT, ESTADO_LABEL, ESTADOS_ACTIVOS, ESTADO_PAGO_LABEL, ESTADO_PAGO_VARIANT } from "./estado";
import Card from "../_components/Card";
import Button from "../_components/Button";
import Modal from "../_components/Modal";
import Badge from "../_components/Badge";
import Table, { type TableColumn } from "../_components/Table";
import { IconDownload, IconPlus } from "@tabler/icons-react";
import { PageActions } from "../_components/PageHeader";
import Aviso from "../_components/Aviso";
import BarraBusqueda from "../_components/BarraFiltros";
import DetallePanel from "./detalle-panel";
import NuevoPedidoPanel from "./nuevo-pedido-panel";

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

// Mismas columnas que Históricos (Negocio, Estado, Pago, Total); el modal de semanas anteriores suma la Semana. La marca «Modificado por
// el cliente» va como badge junto al nombre del negocio. (El borde rojo que tenían las tarjetas era solo el resaltado al pasar el
// mouse, no un dato: en la tabla ese papel lo cumple el hover de la fila.)
function columnas(conSemana: boolean): TableColumn<PedidoB2bReportable>[] {
  return [
    {
      key: "negocio",
      header: "Negocio",
      truncate: true,
      movil: true,
      render: (p) => (
        <span className="flex min-w-0 items-center gap-2 whitespace-nowrap">
          <span className="min-w-[6rem] truncate font-bold">{p.negocioNombre}</span>
          {!p.cancelado && p.modificadoPorClienteAt && (
            <span className="min-w-0 overflow-hidden rounded-[var(--radius-admin-pill)]">
              <Badge variant="advertencia">Modificado por el cliente</Badge>
            </span>
          )}
        </span>
      ),
    },
    ...(conSemana
      ? [{ key: "semana", header: "Semana", movil: true, render: (p: PedidoB2bReportable) => <span className="whitespace-nowrap">{formatFecha(p.semanaInicio)}</span> }]
      : []),
    {
      key: "estado",
      header: "Estado",
      movil: !conSemana,
      render: (p) => (
        <Badge variant={ESTADO_VARIANT[p.estado]} ancho="pedidoB2b">
          {ESTADO_LABEL[p.estado]}
        </Badge>
      ),
    },
    {
      key: "pago",
      header: "Pago",
      render: (p) => (
        <Badge variant={ESTADO_PAGO_VARIANT[p.estadoPago]} ancho="pagoB2b">
          {ESTADO_PAGO_LABEL[p.estadoPago]}
        </Badge>
      ),
    },
    { key: "total", header: "Total", align: "right", render: (p) => <span className="whitespace-nowrap">{formatMoney(p.total)}</span> },
  ];
}

const COLUMNAS_ACTIVOS = columnas(false);
const COLUMNAS_ANTERIORES = columnas(true);

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
  // Pedidos aún activos (Por confirmar, Confirmado, En proceso) de semanas ANTERIORES a la semana en curso: nunca deben quedar
  // sin un lugar donde verse. Se muestran aparte de la vista semanal, sin importar qué semana esté seleccionada.
  const [anteriores, setAnteriores] = useState<PedidoB2bReportable[] | null>(null);
  const [anterioresAbierto, setAnterioresAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  // `?pedido=<id>` abre ese pedido directo (enlaces desde Adopción).
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("pedido"),
  );
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
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

  // semanaInicio < semana en curso, activos y no cancelados; los más viejos primero (son los que más urgen).
  async function fetchAnteriores(actualInicio: string): Promise<PedidoB2bReportable[]> {
    const result = await fetchPedidosB2b(token, {
      estados: ESTADOS_ACTIVOS,
      cancelado: false,
      semanaAntesDe: actualInicio,
      limit: LIMIT,
    });
    return [...result.data].sort((a, b) => a.semanaInicio.localeCompare(b.semanaInicio) || a.createdAt.localeCompare(b.createdAt));
  }

  const actualInicio = semanas?.actual.inicio;
  useEffect(() => {
    if (!actualInicio) return;
    let cancelled = false;
    fetchAnteriores(actualInicio)
      .then((data) => {
        if (!cancelled) setAnteriores(data);
      })
      .catch(() => {
        if (!cancelled) setAnteriores([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, actualInicio]);

  function reload() {
    if (actualInicio) {
      fetchAnteriores(actualInicio)
        .then(setAnteriores)
        .catch(() => {});
    }
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
      const blob = await exportPedidosB2bXlsx(token, {
        estados: ESTADOS_ACTIVOS,
        cancelado: false,
        desde: semanaSeleccionada.inicio,
        hasta: semanaSeleccionada.inicio,
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pedidos-${semanaSeleccionada.inicio}.xlsx`;
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
    <div className="flex flex-col gap-3">
      {/* Aviso compacto (una línea) en vez de la lista completa: «Ver» abre el modal con los pedidos de semanas anteriores. */}
      {anteriores && anteriores.length > 0 && (
        <Aviso tono="ambar" ariaLabel="Pedidos activos de semanas anteriores" accion={{ label: "Ver", onClick: () => setAnterioresAbierto(true) }}>
          Tienes {anteriores.length} {anteriores.length === 1 ? "pedido" : "pedidos"} de semanas anteriores sin cerrar
        </Aviso>
      )}

      <PageActions
        acciones={[
          { key: "exportar", label: "Exportar Excel", icon: <IconDownload size={16} />, tipo: "exportar", onClick: handleExport, disabled: !pedidos, cargando: exporting },
          { key: "nuevo", label: "Nuevo pedido", icon: <IconPlus size={16} />, tipo: "crear", onClick: () => setNuevoAbierto(true), disabled: !semanas },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full items-center gap-3 md:w-auto">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSemanaKey("actual")}
            disabled={!semanas || semanaKey === "actual"}
            aria-label="Semana actual"
          >
            ←
          </Button>
          <span className="min-w-0 flex-1 text-center text-base font-bold text-admin-ink md:min-w-[160px] md:flex-none">
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

      </div>

      <BarraBusqueda
        placeholder="Buscar por negocio…"
        onBuscar={setBusqueda}
        exportar={{ label: "Exportar Excel", onClick: handleExport, disabled: !pedidos, cargando: exporting }}
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
        <Table columns={COLUMNAS_ACTIVOS} data={filtrados} rowKey={(p) => p.id} onRowClick={(p) => setSelectedId(p.id)} />
      )}

      <Modal
        open={anterioresAbierto && !!anteriores && anteriores.length > 0}
        onClose={() => setAnterioresAbierto(false)}
        title="Pedidos de semanas anteriores"
        wide="xl"
        footer={
          <Button variant="secondary" onClick={() => setAnterioresAbierto(false)}>
            Cerrar
          </Button>
        }
      >
        <p className="text-sm text-admin-ink-soft">
          Pedidos que siguen activos de semanas pasadas. Confírmalos, ciérralos o cancélalos para que no se queden pendientes.
        </p>
        <div className="max-h-[55vh] overflow-y-auto">
          <Table
            columns={COLUMNAS_ANTERIORES}
            data={anteriores ?? []}
            rowKey={(p) => p.id}
            onRowClick={(p) => {
              setAnterioresAbierto(false);
              setSelectedId(p.id);
            }}
          />
        </div>
      </Modal>

      <NuevoPedidoPanel
        open={nuevoAbierto}
        semanaInicial={semanas?.siguiente.inicio ?? null}
        onClose={() => setNuevoAbierto(false)}
        onAbrirPedido={(id) => {
          setNuevoAbierto(false);
          setSelectedId(id);
        }}
        onCreado={(id) => {
          // Se abre el pedido recién creado en el panel lateral (puede ser de una semana que esta vista no muestra).
          setNuevoAbierto(false);
          setSelectedId(id);
          reload();
        }}
      />

      <DetallePanel pedidoId={selectedId} onClose={() => setSelectedId(null)} onChanged={reload} />
    </div>
  );
}
