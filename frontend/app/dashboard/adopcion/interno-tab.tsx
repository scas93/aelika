"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, fetchAdopcionInterno, type AdopcionInterno } from "@/lib/api";
import Badge from "../_components/Badge";
import Card from "../_components/Card";
import SummaryCard, { SUMMARY_GRID } from "../_components/SummaryCard";
import { formatoDia, formatoFecha, formatoFechaHora, formatoHoras } from "./modelo";

const MAX = 100;
const ENLACE = "text-admin-accent underline";
const abrir = (id: string) => `/dashboard/pedidos-b2b?pedido=${id}`;

function Lista({ titulo, nota, total, children }: { titulo: string; nota?: string; total: number; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-admin-ink-soft">{titulo}</span>
        <span className="text-sm font-bold">{total}</span>
      </div>
      {nota && <p className="text-xs text-admin-ink-soft">{nota}</p>}
      {total === 0 ? <p className="text-sm text-admin-ink-soft">Nada pendiente.</p> : children}
      {total > MAX && <p className="text-xs text-admin-ink-soft">Se muestran los primeros {MAX} de {total}.</p>}
    </Card>
  );
}

export default function InternoTab({ token }: { token: string }) {
  const [datos, setDatos] = useState<AdopcionInterno | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdopcionInterno(token)
      .then(setDatos)
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar Adopción"));
  }, [token]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!datos) return <p className="text-sm text-admin-ink-soft">Cargando...</p>;

  const { sinConfirmar, entregasAtrasadas, semanasPasadasSinCompletar, tiempos, avisos } = datos;
  const { recibidoAConfirmado: rc, puntualidad: pu } = tiempos;

  return (
    <div className="flex flex-col gap-4">
      <div className={SUMMARY_GRID}>
        <SummaryCard label="Pedidos sin confirmar" value={sinConfirmar.total} error={null} />
        <SummaryCard label="Entregas atrasadas" value={entregasAtrasadas.total} error={null} />
        <SummaryCard label="Pedidos de semanas pasadas sin completar" value={semanasPasadasSinCompletar.total} error={null} />
        <SummaryCard label="Entregas no recogidas (últimas 4 semanas)" value={tiempos.noRecogidas} error={null} />
      </div>

      <Lista titulo="Pedidos sin confirmar" total={sinConfirmar.total} nota="Del más antiguo al más reciente; incluye los de semanas pasadas.">
        <ul className="flex flex-col gap-2 text-sm">
          {sinConfirmar.items.map((p) => (
            <li key={p.pedidoId} className="flex flex-wrap items-center gap-2">
              <Link className={ENLACE} href={abrir(p.pedidoId)}>
                {p.folio}
              </Link>
              <span className="font-semibold">{p.cliente}</span>
              <span className="text-admin-ink-soft">
                recibido {formatoFechaHora(p.recibidoAt)} · espera {formatoHoras(p.horasEspera)}
              </span>
              {p.deSemanaPasada && <Badge variant="advertencia">Semana anterior</Badge>}
            </li>
          ))}
        </ul>
      </Lista>

      <Lista
        titulo="Entregas atrasadas"
        total={entregasAtrasadas.total}
        nota="Entregas con fecha anterior a hoy que siguen pendientes. No se cierran solas."
      >
        <ul className="flex flex-col gap-2 text-sm">
          {entregasAtrasadas.items.map((e) => (
            <li key={e.entregaId} className="flex flex-wrap items-center gap-2">
              <Link className={ENLACE} href={abrir(e.pedidoId)}>
                {e.folio}
              </Link>
              <span className="font-semibold">{e.cliente}</span>
              <span className="text-admin-ink-soft">
                {formatoDia(e.fecha)} · {e.diasAtraso} {e.diasAtraso === 1 ? "día" : "días"} de atraso
              </span>
            </li>
          ))}
        </ul>
      </Lista>

      <Lista titulo="Pedidos de semanas pasadas sin completar" total={semanasPasadasSinCompletar.total}>
        <ul className="flex flex-col gap-2 text-sm">
          {semanasPasadasSinCompletar.items.map((p) => (
            <li key={p.pedidoId} className="flex flex-wrap items-center gap-2">
              <Link className={ENLACE} href={abrir(p.pedidoId)}>
                {p.folio}
              </Link>
              <span className="font-semibold">{p.cliente}</span>
              <span className="text-admin-ink-soft">semana del {formatoDia(p.semana)}</span>
            </li>
          ))}
        </ul>
      </Lista>

      <Card className="flex flex-col gap-3">
        <span className="text-[13px] font-semibold text-admin-ink-soft">Tiempos (últimas {tiempos.ventanaDias / 7} semanas)</span>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Recibido → confirmado</span>
          {rc.casos === 0 ? (
            <p className="text-sm text-admin-ink-soft">Aún no hay datos.</p>
          ) : (
            <p className="text-sm">
              Mediana {formatoHoras(rc.medianaHoras ?? 0)} · el más lento {formatoHoras(rc.maximoHoras ?? 0)}
            </p>
          )}
          <p className="text-xs text-admin-ink-soft">
            Medido en {rc.casos} de {tiempos.pedidosEnVentana} pedidos recibidos: solo cuentan los que tienen fecha de confirmación
            {avisos.confirmadoAtDesde ? ` (se registra desde el ${formatoFecha(avisos.confirmadoAtDesde)})` : " (todavía no se registra en este entorno)"}.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">Puntualidad de entregas</span>
          {pu.casos === 0 ? (
            <p className="text-sm text-admin-ink-soft">Aún no hay datos.</p>
          ) : (
            <p className="text-sm">
              {pu.porcentajeATiempo}% entregadas el día programado · {pu.despues} después de su día
            </p>
          )}
          <p className="text-xs text-admin-ink-soft">
            Medido en {pu.casos} entregas con fecha de cierre registrada
            {pu.sinDato > 0 ? ` (${pu.sinDato} sin ese dato no se cuentan)` : ""}. Las no recogidas no entran en este porcentaje.
          </p>
        </div>
      </Card>
    </div>
  );
}
