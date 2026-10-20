"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight, IconDots, IconDownload, IconInbox, IconPrinter, IconX } from "@tabler/icons-react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  avanzarPedidoB2b,
  cerrarEntregaPedidoB2b,
  exportPedidosB2bDiaXlsx,
  fetchPedidosB2bDia,
  type PedidoB2bEntregaDia,
} from "@/lib/api";
import { hoyYYYYMMDD } from "@/lib/fecha";
import { useEsMovil } from "@/lib/use-es-movil";
import { isWebUsbSupported, printComandaB2bDiaWebUsb } from "@/lib/thermal-printer";
import Card from "../../_components/Card";
import Button from "../../_components/Button";
import Badge from "../../_components/Badge";
import Table, { type TableColumn } from "../../_components/Table";
import MenuAcciones from "../../_components/MenuAcciones";
import BotonExportar from "../../_components/BotonExportar";
import { ESTADO_ENTREGA_LABEL, ESTADO_ENTREGA_VARIANT, puedeCerrarEntregas } from "../estado";
import DetallePanel from "../detalle-panel";

// timeZone: "UTC" en todo este archivo — `fecha` es un string "YYYY-MM-DD"
// parseado como medianoche UTC (mismo motivo que formatFecha en
// pedidos-b2b/page.tsx): formatear/sumar días en la zona local del
// navegador puede correr la fecha un día, sobre todo cerca de medianoche.
function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// «Hoy · lunes 19 oct», «Mañana · …», «Ayer · …»; otros días solo «miércoles 21 oct».
function formatFechaSelector(fecha: string, hoy: string): string {
  const d = new Date(`${fecha}T00:00:00.000Z`);
  const texto = d
    .toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })
    .replace(/\./g, "")
    .replace(",", "")
    .replace(" de ", " ");
  const rel = fecha === hoy ? "Hoy" : fecha === sumarDias(hoy, 1) ? "Mañana" : fecha === sumarDias(hoy, -1) ? "Ayer" : null;
  return rel ? `${rel} · ${texto}` : texto;
}

function formatFechaLarga(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00.000Z`);
  const texto = d.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Pendientes y listas primero (lo que falta por hacer), luego las ya cerradas; dentro de cada grupo se conserva el orden del servidor
// (por negocio).
const ORDEN_ESTADO: Record<PedidoB2bEntregaDia["entregaEstado"], number> = {
  PENDIENTE: 0,
  LISTA: 0,
  ENTREGADA: 1,
  NO_RECOGIDA: 2,
  CANCELADA: 3,
};

const piezasDe = (e: PedidoB2bEntregaDia) => e.items.reduce((s, i) => s + i.cantidad, 0);
const sinConfirmar = (e: PedidoB2bEntregaDia) => e.estado === "PENDIENTE_CONFIRMACION" && !e.cancelado;
const abierta = (e: PedidoB2bEntregaDia) => e.entregaEstado === "PENDIENTE" || e.entregaEstado === "LISTA";

export default function PedidosB2bDiaPage() {
  const { token, user } = useSession();
  const esAdmin = user.rol === "GERENTE" || user.rol === "DUENO";
  const movil = useEsMovil();
  const [fecha, setFecha] = useState(() => hoyYYYYMMDD());
  const [entregas, setEntregas] = useState<PedidoB2bEntregaDia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [webUsbSupported, setWebUsbSupported] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [imprimiendoTodo, setImprimiendoTodo] = useState<{ hechas: number; total: number } | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [cerrandoId, setCerrandoId] = useState<string | null>(null);
  const [cerrarError, setCerrarError] = useState<string | null>(null);
  const [desplegadas, setDesplegadas] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time browser capability check
    setWebUsbSupported(isWebUsbSupported());
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets stale state before re-fetching whenever `fecha` changes
    setError(null);
    setPrintError(null);
    setDesplegadas(new Set());
    fetchPedidosB2bDia(token, fecha)
      .then((data) => {
        if (!cancelled) setEntregas(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "No se pudieron cargar las entregas del día");
      });
    return () => {
      cancelled = true;
    };
  }, [token, fecha]);

  const recargar = useCallback(async () => {
    setEntregas(await fetchPedidosB2bDia(token, fecha));
  }, [token, fecha]);

  // Las canceladas nunca vienen en este listado (el servidor las excluye), pero por si acaso no cuentan en nada.
  const vigentes = useMemo(() => (entregas ?? []).filter((e) => e.entregaEstado !== "CANCELADA"), [entregas]);
  const ordenadas = useMemo(
    () => [...vigentes].sort((a, b) => ORDEN_ESTADO[a.entregaEstado] - ORDEN_ESTADO[b.entregaEstado]),
    [vigentes],
  );

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await exportPedidosB2bDiaXlsx(token, fecha);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `entregas-${fecha}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : "No se pudo exportar el día");
    } finally {
      setExporting(false);
    }
  }

  // Cierra UNA entrega (Entregada / No recogida) y recarga el día. Cualquier rol puede hacerlo.
  async function handleCerrar(entrega: PedidoB2bEntregaDia, estado: "ENTREGADA" | "NO_RECOGIDA") {
    setCerrandoId(entrega.entregaId);
    setCerrarError(null);
    try {
      await cerrarEntregaPedidoB2b(token, entrega.id, entrega.entregaId, estado);
      await recargar();
    } catch (err) {
      setCerrarError(err instanceof ApiError ? err.message : "No se pudo cerrar la entrega");
    } finally {
      setCerrandoId(null);
    }
  }

  // Confirmar el pedido desde la fila: mismo endpoint y permisos que el panel del pedido (solo Gerente/Dueño).
  async function handleConfirmar(entrega: PedidoB2bEntregaDia) {
    setCerrandoId(entrega.entregaId);
    setCerrarError(null);
    try {
      await avanzarPedidoB2b(token, entrega.id);
      await recargar();
    } catch (err) {
      setCerrarError(err instanceof ApiError ? err.message : "No se pudo confirmar el pedido");
    } finally {
      setCerrandoId(null);
    }
  }

  const contextoImpresion = () => ({
    nombreNegocioTenant: user.tenant.nombre,
    fechaLabel: formatFechaLarga(fecha),
    impresoPor: { nombre: user.nombre, rol: user.rol },
  });

  async function handleImprimir(entrega: PedidoB2bEntregaDia) {
    setPrintingId(entrega.id);
    setPrintError(null);
    try {
      await printComandaB2bDiaWebUsb(entrega, contextoImpresion());
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : "No se pudo imprimir la comanda");
    } finally {
      setPrintingId(null);
    }
  }

  // Imprime la hoja de entrega de TODAS las entregas no canceladas del día, una tras otra, en el mismo formato que la individual.
  async function handleImprimirTodo() {
    const lista = ordenadas;
    setPrintError(null);
    setImprimiendoTodo({ hechas: 0, total: lista.length });
    try {
      for (let i = 0; i < lista.length; i++) {
        await printComandaB2bDiaWebUsb(lista[i], contextoImpresion());
        setImprimiendoTodo({ hechas: i + 1, total: lista.length });
      }
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : "No se pudo imprimir todo");
    } finally {
      setImprimiendoTodo(null);
    }
  }

  function alternar(id: string) {
    setDesplegadas((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });
  }

  const columnas: TableColumn<PedidoB2bEntregaDia>[] = [
    {
      key: "negocio",
      header: "Negocio",
      truncate: true,
      movil: true,
      render: (e) => (
        // Una sola línea: el nombre se recorta con «…» solo si de verdad no cabe.
        <div className="flex min-w-0 flex-col items-start">
          <span className="flex min-w-0 max-w-full items-center gap-2">
            {desplegadas.has(e.id) ? (
              <IconChevronDown size={14} className="shrink-0 text-admin-ink-soft" />
            ) : (
              <IconChevronRight size={14} className="shrink-0 text-admin-ink-soft" />
            )}
            {/* El nombre abre el panel del pedido; el resto de la fila despliega sus productos. */}
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                setSelectedId(e.id);
              }}
              className="min-w-0 truncate text-left font-bold text-admin-ink hover:underline"
            >
              {e.negocioNombre}
            </button>
          </span>
        </div>
      ),
    },
    { key: "piezas", header: "Piezas", align: "right", compact: true, render: (e) => <span className="tabular-nums">{piezasDe(e)}</span> },
    {
      key: "estado",
      header: "Estado",
      compact: true,
      movil: true,
      render: (e) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          {sinConfirmar(e) ? (
            <Badge variant="advertencia" ancho="entrega">
              Sin confirmar
            </Badge>
          ) : (
            <Badge variant={ESTADO_ENTREGA_VARIANT[e.entregaEstado]} ancho="entrega">
              {ESTADO_ENTREGA_LABEL[e.entregaEstado]}
            </Badge>
          )}
          {e.atrasada && <Badge variant="advertencia">Atrasada</Badge>}
        </span>
      ),
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      compact: true,
      movil: true,
      render: (e) => (
        // Una sola línea: «Entregada» a la vista y el resto en el menú «⋯». Los botones no despliegan la fila.
        <div className="flex items-center justify-end gap-2 whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
          {!movil && esAdmin && sinConfirmar(e) && (
            <Button variant="secondary" size="sm" onClick={() => handleConfirmar(e)} disabled={cerrandoId !== null}>
              {cerrandoId === e.entregaId ? "Guardando..." : "Confirmar pedido"}
            </Button>
          )}
          {!movil && puedeCerrarEntregas(e.estado, e.cancelado) && abierta(e) && (
            <Button
              variant="secondary"
              size="sm"
              className="inline-flex items-center gap-1.5"
              onClick={() => handleCerrar(e, "ENTREGADA")}
              disabled={cerrandoId !== null}
            >
              <IconCheck size={14} className="shrink-0" />
              {cerrandoId === e.entregaId ? "Guardando..." : "Entregada"}
            </Button>
          )}
          <MenuAcciones
            acciones={[
              // En el teléfono «Entregada» también va en el menú «⋯» (la tabla muestra solo Negocio, Estado y el menú).
              ...(movil && esAdmin && sinConfirmar(e)
                ? [{ label: "Confirmar pedido", icon: <IconCheck size={14} />, onClick: () => handleConfirmar(e), disabled: cerrandoId !== null }]
                : []),
              ...(movil && puedeCerrarEntregas(e.estado, e.cancelado) && abierta(e)
                ? [{ label: "Entregada", icon: <IconCheck size={14} />, onClick: () => handleCerrar(e, "ENTREGADA"), disabled: cerrandoId !== null }]
                : []),
              ...(puedeCerrarEntregas(e.estado, e.cancelado) && abierta(e)
                ? [{ label: "No recogida", icon: <IconX size={14} />, onClick: () => handleCerrar(e, "NO_RECOGIDA"), disabled: cerrandoId !== null }]
                : []),
              {
                label: printingId === e.id ? "Imprimiendo..." : "Imprimir",
                icon: <IconPrinter size={14} />,
                onClick: () => handleImprimir(e),
                disabled: printingId === e.id || imprimiendoTodo !== null || !webUsbSupported,
              },
            ]}
          />
        </div>
      ),
    },
  ];

  const hoy = hoyYYYYMMDD();
  const sinEntregas = entregas !== null && vigentes.length === 0;
  const accionImprimirTodo = imprimiendoTodo ? `Imprimiendo ${imprimiendoTodo.hechas}/${imprimiendoTodo.total}...` : "Imprimir todo";
  const sinImprimir = sinEntregas || entregas === null || vigentes.length === 0 || imprimiendoTodo !== null || !webUsbSupported;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-full items-center gap-3 md:w-auto">
          <Button variant="secondary" size="sm" onClick={() => setFecha((f) => sumarDias(f, -1))} aria-label="Día anterior">
            <IconChevronLeft size={14} />
          </Button>
          <span className="min-w-0 flex-1 text-center text-base font-bold first-letter:uppercase text-admin-ink md:min-w-[220px] md:flex-none">
            {formatFechaSelector(fecha, hoy)}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setFecha((f) => sumarDias(f, 1))} aria-label="Día siguiente">
            <IconChevronRight size={14} />
          </Button>
          {fecha !== hoy && (
            <Button variant="secondary" size="sm" onClick={() => setFecha(hoy)}>
              Hoy
            </Button>
          )}
          {movil && (
            <MenuAcciones
              label="Más acciones"
              icono={<IconDots size={20} />}
              acciones={[
                { label: accionImprimirTodo, icon: <IconPrinter size={14} />, onClick: handleImprimirTodo, disabled: sinImprimir },
                { label: "Exportar Excel", icon: <IconDownload size={14} />, onClick: handleExport, disabled: !entregas || entregas.length === 0 || exporting },
              ]}
            />
          )}
        </div>
        {!movil && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" className="inline-flex items-center gap-1.5" onClick={handleImprimirTodo} disabled={sinImprimir}>
              <IconPrinter size={16} />
              {accionImprimirTodo}
            </Button>
            <BotonExportar label="Exportar Excel" onClick={handleExport} disabled={!entregas || entregas.length === 0} cargando={exporting} />
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {exportError && <p className="text-sm text-red-600">{exportError}</p>}
      {printError && <p className="text-sm text-red-600">{printError}</p>}
      {cerrarError && <p className="text-sm text-red-600">{cerrarError}</p>}
      {!webUsbSupported && (
        <p className="text-sm text-admin-ink-soft">Imprimir comandas requiere Chrome o Edge — no está disponible en este navegador.</p>
      )}

      {entregas === null ? (
        <p className="text-sm text-admin-ink-soft">Cargando...</p>
      ) : sinEntregas ? (
        <Card className="flex flex-col items-center gap-1 py-10 text-center">
          <IconInbox size={28} className="text-admin-ink-soft" />
          <span className="text-sm font-semibold text-admin-ink">No hay entregas programadas para este día.</span>
          <span className="text-sm text-admin-ink-soft">Usa las flechas para revisar otro día.</span>
        </Card>
      ) : (
        <>
          <Table
            columns={columnas}
            data={ordenadas}
            rowKey={(e) => e.id}
            onRowClick={(e) => alternar(e.id)}
            expandedRow={(e) =>
              desplegadas.has(e.id) ? (
                <ul className="flex flex-col gap-1">
                  {e.items.map((item, i) => (
                    <li key={`${item.productId}-${i}`} className="flex items-baseline gap-3 text-sm text-admin-ink">
                      <span className="w-10 text-right font-bold tabular-nums">{item.cantidad}</span>
                      <span>{item.nombreProducto}</span>
                    </li>
                  ))}
                </ul>
              ) : null
            }
          />
        </>
      )}

      {/* Tras cerrar o corregir una entrega desde el panel, el día se vuelve a consultar. */}
      <DetallePanel pedidoId={selectedId} onClose={() => setSelectedId(null)} onChanged={() => void recargar()} />
    </div>
  );
}
