"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  cerrarEntregaPedidoB2b,
  exportPedidosB2bDiaCsv,
  fetchPedidosB2bDia,
  fetchTenantSettings,
  type PedidoB2bEntregaDia,
} from "@/lib/api";
import { hoyYYYYMMDD } from "@/lib/fecha";
import { isWebUsbSupported, printComandaB2bDiaWebUsb } from "@/lib/thermal-printer";
import Card from "../../_components/Card";
import Button from "../../_components/Button";
import Badge from "../../_components/Badge";
import { ESTADO_ENTREGA_LABEL, ESTADO_ENTREGA_VARIANT, puedeCerrarEntregas } from "../estado";
import { formatearFolioB2b } from "@/lib/format";

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

export default function PedidosB2bDiaPage() {
  const { token, user } = useSession();
  const [fecha, setFecha] = useState(() => hoyYYYYMMDD());
  const [entregas, setEntregas] = useState<PedidoB2bEntregaDia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nombreNegocio, setNombreNegocio] = useState("");
  const [webUsbSupported, setWebUsbSupported] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const [cerrandoId, setCerrandoId] = useState<string | null>(null);
  const [cerrarError, setCerrarError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time browser capability check
    setWebUsbSupported(isWebUsbSupported());
  }, []);

  useEffect(() => {
    fetchTenantSettings(token)
      .then((settings) => setNombreNegocio(settings.nombre))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets stale error state before re-fetching whenever `fecha` changes
    setError(null);
    setPrintError(null);
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

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await exportPedidosB2bDiaCsv(token, fecha);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pedidos-b2b-${fecha}.csv`;
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
      setEntregas(await fetchPedidosB2bDia(token, fecha));
    } catch (err) {
      setCerrarError(err instanceof ApiError ? err.message : "No se pudo cerrar la entrega");
    } finally {
      setCerrandoId(null);
    }
  }

  async function handleImprimir(entrega: PedidoB2bEntregaDia) {
    setPrintingId(entrega.id);
    setPrintError(null);
    try {
      await printComandaB2bDiaWebUsb(entrega, {
        nombreNegocioTenant: nombreNegocio,
        fechaLabel: formatFechaLarga(fecha),
        impresoPor: { nombre: user.nombre, rol: user.rol },
      });
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : "No se pudo imprimir la comanda");
    } finally {
      setPrintingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => setFecha((f) => sumarDias(f, -1))} aria-label="Día anterior">
            ←
          </Button>
          <span className="min-w-[220px] text-center text-base font-bold text-admin-ink">{formatFechaLarga(fecha)}</span>
          <Button variant="secondary" size="sm" onClick={() => setFecha((f) => sumarDias(f, 1))} aria-label="Día siguiente">
            →
          </Button>
          {fecha !== hoyYYYYMMDD() && (
            <button
              type="button"
              onClick={() => setFecha(hoyYYYYMMDD())}
              className="text-sm font-semibold text-mayoreo-accent hover:underline"
            >
              Hoy
            </button>
          )}
        </div>

        <Button variant="secondary" onClick={handleExport} disabled={exporting || !entregas || entregas.length === 0}>
          {exporting ? "Exportando..." : "📥 Exportar Excel"}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {exportError && <p className="text-sm text-red-600">{exportError}</p>}
      {printError && <p className="text-sm text-red-600">{printError}</p>}
      {cerrarError && <p className="text-sm text-red-600">{cerrarError}</p>}
      {!webUsbSupported && (
        <p className="text-sm text-admin-ink-soft">
          Imprimir comandas requiere Chrome o Edge — no está disponible en este navegador.
        </p>
      )}

      {entregas === null ? (
        <p className="text-sm text-admin-ink-soft">Cargando...</p>
      ) : entregas.length === 0 ? (
        <Card className="flex flex-col items-center gap-1 py-10 text-center">
          <span className="text-2xl">📭</span>
          <span className="text-sm font-semibold text-admin-ink">No hay entregas programadas para este día.</span>
          <span className="text-sm text-admin-ink-soft">Usa las flechas para revisar otro día.</span>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {entregas.map((entrega) => (
            <li key={entrega.id}>
              <Card padding={20}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-admin-ink">{formatearFolioB2b(entrega.folio)}</span>
                      <span className="text-sm font-semibold text-admin-ink">{entrega.negocioNombre}</span>
                      {entrega.atrasada && <Badge variant="peligro">Atrasada</Badge>}
                      <Badge variant={ESTADO_ENTREGA_VARIANT[entrega.entregaEstado]}>{ESTADO_ENTREGA_LABEL[entrega.entregaEstado]}</Badge>
                    </div>
                    <ul className="flex flex-col gap-0.5">
                      {entrega.items.map((item, i) => (
                        <li key={`${item.productId}-${i}`} className="text-sm text-admin-ink-soft">
                          {item.cantidad}× {item.nombreProducto}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {puedeCerrarEntregas(entrega.estado, entrega.cancelado) &&
                      (entrega.entregaEstado === "PENDIENTE" || entrega.entregaEstado === "LISTA") && (
                        <div className="flex gap-2">
                          <Button variant="primary" size="sm" onClick={() => handleCerrar(entrega, "ENTREGADA")} disabled={cerrandoId !== null}>
                            {cerrandoId === entrega.entregaId ? "Guardando..." : "Entregada"}
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => handleCerrar(entrega, "NO_RECOGIDA")} disabled={cerrandoId !== null}>
                            No recogida
                          </Button>
                        </div>
                      )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleImprimir(entrega)}
                      disabled={printingId === entrega.id || !webUsbSupported}
                    >
                      {printingId === entrega.id ? "Imprimiendo..." : "🖨️ Imprimir"}
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
