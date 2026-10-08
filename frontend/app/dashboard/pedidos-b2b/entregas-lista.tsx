"use client";

import { useState } from "react";
import { ApiError, type PedidoB2bEntrega } from "@/lib/api";
import { DIAS_SEMANA_PEDIDO_B2B } from "@/lib/api";
import Badge from "../_components/Badge";
import Button from "../_components/Button";
import { ESTADO_ENTREGA_LABEL, ESTADO_ENTREGA_VARIANT } from "./estado";

// timeZone: "UTC" — `fecha` es un @db.Date (medianoche UTC); en la zona local del navegador puede caer un día antes.
function formatFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function formatCierre(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Las entregas de un pedido con su estado. Con `onCerrar`, cada entrega pendiente muestra "Entregada" / "No recogida"
// (una por una, nunca en bloque); sin él es solo lectura (Históricos).
export default function EntregasLista({
  entregas,
  onCerrar,
}: {
  entregas: PedidoB2bEntrega[];
  onCerrar?: (entregaId: string, estado: "ENTREGADA" | "NO_RECOGIDA") => Promise<void>;
}) {
  const [cerrando, setCerrando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cerrar(entregaId: string, estado: "ENTREGADA" | "NO_RECOGIDA") {
    if (!onCerrar) return;
    setCerrando(entregaId);
    setError(null);
    try {
      await onCerrar(entregaId, estado);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cerrar la entrega");
    } finally {
      setCerrando(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-bold text-admin-ink">Entregas</span>
      <ul className="flex flex-col gap-2">
        {entregas.map((entrega) => {
          const pendiente = entrega.estado === "PENDIENTE" || entrega.estado === "LISTA";
          return (
            <li
              key={entrega.id}
              className="flex flex-col gap-2 rounded-[var(--radius-admin-control)] border border-admin-border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-admin-ink">
                  {DIAS_SEMANA_PEDIDO_B2B.find((d) => d.value === entrega.dia)?.label ?? ""} · {formatFecha(entrega.fecha)}
                </span>
                <div className="flex items-center gap-1.5">
                  {entrega.atrasada && <Badge variant="peligro">Atrasada</Badge>}
                  <Badge variant={ESTADO_ENTREGA_VARIANT[entrega.estado]}>{ESTADO_ENTREGA_LABEL[entrega.estado]}</Badge>
                </div>
              </div>
              {entrega.cerradaAt && <span className="text-xs text-admin-ink-soft">Cerrada el {formatCierre(entrega.cerradaAt)}</span>}
              {onCerrar && pendiente && (
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" onClick={() => cerrar(entrega.id, "ENTREGADA")} disabled={cerrando !== null}>
                    {cerrando === entrega.id ? "Guardando..." : "Entregada"}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => cerrar(entrega.id, "NO_RECOGIDA")} disabled={cerrando !== null}>
                    No recogida
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
