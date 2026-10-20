"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight, IconDownload, IconInbox, IconPrinter, IconX } from "@tabler/icons-react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
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
import { PageActions } from "../../_components/PageHeader";
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
  // Abierta por defecto al entrar y al cambiar de día.
  const [produccionAbierta, setProduccionAbierta] = useState(true);
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
    setProduccionAbierta(true);
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
  const entregadas = vigentes.filter((e) => e.entregaEstado === "ENTREGADA").length;
  const pendientes = vigentes.filter(abierta).length;
  // El total por producto cuenta también las entregas de pedidos «Por confirmar»; se avisa cuántas piezas son.
  const piezasSinConfirmar = vigentes.filter(sinConfirmar).reduce((s, e) => s + piezasDe(e), 0);

  // Total por producto: cada producto con su cantidad total sumando todos los clientes; mayor cantidad primero.
  const produccion = useMemo(() => {
    const mapa = new Map<string, { nombre: string; cantidad: number }>();
    for (const e of vigentes) {
      for (const i of e.items) {
        const clave = i.productId ?? i.nombreProducto;
        const fila = mapa.get(clave) ?? { nombre: i.nombreProducto, cantidad: 0 };
        fila.cantidad += i.cantidad;
        mapa.set(clave, fila);
      }
    }
    return [...mapa.values()].sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre));
  }, [vigentes]);

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
        // El nombre siempre se ve (se recorta con «…» solo si de verdad no cabe); el badge va debajo, sin invadir otras columnas.
        <div className="flex min-w-0 flex-col items-start gap-1">
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
          {sinConfirmar(e) && (
            <span className="pl-[22px]">
              <Badge variant="advertencia">{movil ? "Sin confirmar" : "Pedido sin confirmar"}</Badge>
            </span>
          )}
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
          <Badge variant={ESTADO_ENTREGA_VARIANT[e.entregaEstado]} ancho="entrega">
            {ESTADO_ENTREGA_LABEL[e.entregaEstado]}
          </Badge>
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

  return (
    <div className="flex flex-col gap-3">
      <PageActions
        acciones={[
          {
            key: "imprimir",
            label: imprimiendoTodo ? `Imprimiendo ${imprimiendoTodo.hechas}/${imprimiendoTodo.total}...` : "Imprimir todo",
            icon: <IconPrinter size={16} />,
            onClick: handleImprimirTodo,
            disabled: sinEntregas || entregas === null || vigentes.length === 0 || imprimiendoTodo !== null || !webUsbSupported,
          },
          { key: "exportar", label: "Exportar Excel", icon: <IconDownload size={16} />, tipo: "exportar", onClick: handleExport, disabled: !entregas || entregas.length === 0, cargando: exporting },
        ]}
      />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex w-full items-center gap-3 md:w-auto">
            <Button variant="secondary" size="sm" onClick={() => setFecha((f) => sumarDias(f, -1))} aria-label="Día anterior">
              <IconChevronLeft size={14} />
            </Button>
            <span className="min-w-0 flex-1 text-center text-base font-bold text-admin-ink md:min-w-[220px] md:flex-none">{formatFechaLarga(fecha)}</span>
            <Button variant="secondary" size="sm" onClick={() => setFecha((f) => sumarDias(f, 1))} aria-label="Día siguiente">
              <IconChevronRight size={14} />
            </Button>
            {fecha !== hoy && (
              <Button variant="secondary" size="sm" onClick={() => setFecha(hoy)}>
                Hoy
              </Button>
            )}
          </div>

        </div>

        {entregas !== null && vigentes.length > 0 && (
          <p className="text-sm text-admin-ink-soft">
            {vigentes.length} {vigentes.length === 1 ? "entrega" : "entregas"} · {entregadas} {entregadas === 1 ? "entregada" : "entregadas"} ·{" "}
            {pendientes} {pendientes === 1 ? "pendiente" : "pendientes"}
          </p>
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
          <Card padding={0}>
            <button
              type="button"
              onClick={() => setProduccionAbierta((v) => !v)}
              aria-expanded={produccionAbierta}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-bold text-admin-ink"
            >
              {produccionAbierta ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              Total por producto
              <span className="font-normal text-admin-ink-soft">
                · {produccion.length} {produccion.length === 1 ? "producto" : "productos"}
              </span>
            </button>
            {produccionAbierta && piezasSinConfirmar > 0 && (
              <p className="-mt-1 px-4 pb-2 pl-10 text-xs text-admin-ink-soft">
                Incluye {piezasSinConfirmar} {piezasSinConfirmar === 1 ? "pieza" : "piezas"} de pedidos sin confirmar
              </p>
            )}
            {produccionAbierta && (
              <ul className="flex flex-col border-t border-admin-border px-4 py-2 text-sm text-admin-ink">
                {produccion.map((p) => (
                  <li key={p.nombre} className="flex items-center justify-between gap-4 py-1">
                    <span>{p.nombre}</span>
                    <span className="font-bold tabular-nums">{p.cantidad}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

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
