"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  exportPedidosB2bXlsx,
  fetchPedidosB2b,
  fetchPedidosB2bResumen,
  type PedidoB2bEstado,
  type PedidoB2bEstadoPago,
  type PedidoB2bReportable,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { ESTADO_VARIANT, ESTADO_LABEL, ESTADOS_ACTIVOS, ESTADOS_PAGO_FILTRO, ESTADO_PAGO_LABEL, ESTADO_PAGO_VARIANT } from "./estado";
import Card from "../_components/Card";
import Button from "../_components/Button";
import Modal from "../_components/Modal";
import Badge from "../_components/Badge";
import Table, { type TableColumn } from "../_components/Table";
import { IconDownload } from "@tabler/icons-react";
import { FiltroMultiSelectPopover, labelMultiSelect } from "../_components/FiltroMultiSelect";
import { FiltroTextoPopover } from "../_components/FiltroTexto";
import Aviso from "../_components/Aviso";
import SelectorPeriodo, { accionPeriodo } from "../_components/SelectorPeriodo";
import { lunesDe } from "../_components/Calendario";
import { hoyYYYYMMDD } from "@/lib/fecha";
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
  // Filtros sobre la semana elegida (en el cliente: ya se trajeron todos los activos de esa semana).
  // Estado y Pago son de selección múltiple (O dentro del filtro, Y entre filtros); vacío = todos.
  const [fEstado, setFEstado] = useState<PedidoB2bEstado[]>([]);
  const [fPago, setFPago] = useState<PedidoB2bEstadoPago[]>([]);
  const [fNegocio, setFNegocio] = useState<string | null>(null);
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
    const q = (fNegocio ?? "").toLowerCase();
    return pedidos.filter(
      (p) =>
        (fEstado.length === 0 || fEstado.includes(p.estado)) &&
        (fPago.length === 0 || fPago.includes(p.estadoPago)) &&
        (!q || p.negocioNombre.toLowerCase().includes(q)),
    );
  }, [pedidos, fEstado, fPago, fNegocio]);
  const cambiarSemana = (v: string) => setSemanaKey(semanas && v >= semanas.siguiente.inicio.slice(0, 10) ? "siguiente" : "actual");
  const accionActual = accionPeriodo("semana", semanaSeleccionada?.inicio.slice(0, 10) ?? lunesDe(hoyYYYYMMDD()), cambiarSemana, !semanas);
  const hayFiltros = !!(fEstado.length > 0 || fPago.length > 0 || fNegocio);

  async function handleExport() {
    if (!semanaSeleccionada) return;
    setExporting(true);
    setExportError(null);
    try {
      const blob = await exportPedidosB2bXlsx(token, {
        // Con estados elegidos se mandan esos (`estados` tiene prioridad en el backend); sin ninguno, los 3 activos.
        estados: fEstado.length > 0 ? fEstado : ESTADOS_ACTIVOS,
        cancelado: false,
        desde: semanaSeleccionada.inicio,
        hasta: semanaSeleccionada.inicio,
        estadoPago: fPago.length > 0 ? fPago : undefined,
        negocioNombre: fNegocio?.trim() || undefined,
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

      <BarraBusqueda
        izquierda={({ corto }) => (
          <SelectorPeriodo
            modo="semana"
            corto={corto}
            valor={semanaSeleccionada?.inicio.slice(0, 10) ?? lunesDe(hoyYYYYMMDD())}
            deshabilitado={!semanas}
            // La navegación es solo entre la semana en curso y la próxima; las anteriores están en el aviso de arriba.
            min={semanas?.actual.inicio.slice(0, 10)}
            max={semanas?.siguiente.inicio.slice(0, 10)}
            tooltipMin="Las semanas anteriores están en el aviso de arriba"
            onChange={cambiarSemana}
          />
        )}
        acciones={[
          ...(accionActual ? [accionActual] : []),
          { key: "exportar", label: "Exportar Excel", icon: <IconDownload size={16} />, tipo: "exportar", onClick: handleExport, disabled: !pedidos, cargando: exporting },
        ]}
        crear={{ label: "Nuevo pedido", onClick: () => setNuevoAbierto(true), disabled: !semanas }}
        filtros={[
          {
            key: "estado",
            label: "Estado",
            valueLabel: labelMultiSelect(fEstado, (e) => ESTADO_LABEL[e]),
            onClear: () => setFEstado([]),
            render: () => (
              <FiltroMultiSelectPopover
                opciones={ESTADOS_ACTIVOS.map((e) => ({ value: e, label: ESTADO_LABEL[e] }))}
                valoresAplicados={fEstado}
                onAplicar={setFEstado}
              />
            ),
          },
          {
            key: "pago",
            label: "Pago",
            valueLabel: labelMultiSelect(fPago, (e) => ESTADO_PAGO_LABEL[e]),
            onClear: () => setFPago([]),
            render: () => (
              <FiltroMultiSelectPopover
                opciones={ESTADOS_PAGO_FILTRO.map((e) => ({ value: e, label: ESTADO_PAGO_LABEL[e] }))}
                valoresAplicados={fPago}
                onAplicar={setFPago}
              />
            ),
          },
          {
            key: "negocio",
            label: "Negocio",
            valueLabel: fNegocio,
            onClear: () => setFNegocio(null),
            render: () => <FiltroTextoPopover valorAplicado={fNegocio} onAplicar={setFNegocio} placeholder="Buscar negocio…" />,
          },
        ]}
      />

      {semanaError && <p className="text-sm text-red-600">{semanaError}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {exportError && <p className="text-sm text-red-600">{exportError}</p>}

      {filtrados === null ? (
        <p className="text-sm text-admin-ink-soft">Cargando...</p>
      ) : filtrados.length === 0 ? (
        <Card className="text-sm text-admin-ink-soft">
          {hayFiltros ? "No hay pedidos activos que coincidan con estos filtros." : "No hay pedidos activos para esta semana."}
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
