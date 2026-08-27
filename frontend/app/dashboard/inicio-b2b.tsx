"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchPedidosB2bResumen, type PedidoB2bResumen } from "@/lib/api";
import { rangoSemanaTexto } from "@/lib/pedido-b2b-fechas";
import Card from "./_components/Card";
import SummaryCard from "./_components/SummaryCard";

// Cada folio de este módulo enlaza a la lista de Pedidos activos — no al
// detalle directo (fuera de alcance de este widget, ver auditoría) — con el
// folio visible ahí mismo para ubicarlo.
const PEDIDOS_ACTIVOS_HREF = "/dashboard/pedidos-b2b";

function FolioLink({ folio }: { folio: string }) {
  return (
    <Link
      href={PEDIDOS_ACTIVOS_HREF}
      className="shrink-0 text-xs font-bold text-admin-green-dark hover:underline"
    >
      #{folio}
    </Link>
  );
}

export default function InicioB2B() {
  const { token } = useSession();
  const [resumen, setResumen] = useState<PedidoB2bResumen | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPedidosB2bResumen(token)
      .then(setResumen)
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar el resumen"));
  }, [token]);

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!resumen) {
    return <p className="text-sm text-admin-ink-soft">Cargando...</p>;
  }

  const { semanaEnCurso, proximaSemana, rankingProductos } = resumen;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <SeccionTitulo titulo="Semana en curso" inicio={semanaEnCurso.inicio} fin={semanaEnCurso.fin} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <SummaryCard label="Pendientes de confirmación" value={semanaEnCurso.pendientesConfirmacion} error={null} />
          <SummaryCard label="Confirmados y surtiendo" value={semanaEnCurso.confirmadosSurtiendo} error={null} />
          <SummaryCard label="Piezas de la semana" value={semanaEnCurso.totalPiezas} error={null} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ListaEntregas titulo="Entregas de hoy" entregas={semanaEnCurso.entregasHoy} />
          <ListaEntregas titulo="Entregas de mañana" entregas={semanaEnCurso.entregasManana} />
        </div>

        <PendientesMasAntiguos pendientes={semanaEnCurso.pendientesMasAntiguos} />
      </section>

      <section className="flex flex-col gap-3">
        <SeccionTitulo titulo="Próxima semana" inicio={proximaSemana.inicio} fin={proximaSemana.fin} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SummaryCard label="Pedidos recibidos" value={proximaSemana.totalPedidos} error={null} />
          <SummaryCard label="Piezas acumuladas" value={proximaSemana.totalPiezas} error={null} />
        </div>
      </section>

      <Card className="flex flex-col gap-4">
        <span className="text-[13px] font-semibold text-admin-ink-soft">
          Ranking de productos — semana en curso + próxima semana
        </span>
        {rankingProductos.length === 0 ? (
          <p className="text-sm text-admin-ink-soft">Todavía no hay pedidos para armar un ranking.</p>
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rankingProductos} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-admin-border)" />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: "var(--color-admin-ink-soft)" }}
                  axisLine={{ stroke: "var(--color-admin-border)" }}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="nombreProducto"
                  tick={{ fontSize: 12, fill: "var(--color-admin-ink-soft)" }}
                  axisLine={false}
                  tickLine={false}
                  width={140}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-admin-bg)" }}
                  formatter={(value) => [value, "Piezas"]}
                  labelStyle={{ color: "var(--color-admin-ink)" }}
                />
                <Bar dataKey="cantidadTotal" fill="var(--color-admin-green)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}

function SeccionTitulo({ titulo, inicio, fin }: { titulo: string; inicio: string; fin: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-lg font-extrabold text-admin-ink">{titulo}</h2>
      <span className="text-xs font-medium text-admin-ink-soft">Semana del {rangoSemanaTexto(inicio, fin)}</span>
    </div>
  );
}

function ListaEntregas({
  titulo,
  entregas,
}: {
  titulo: string;
  entregas: { folio: string; negocioNombre: string; cantidad: number }[];
}) {
  return (
    <Card className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-admin-ink-soft">{titulo}</span>
      {entregas.length === 0 ? (
        <p className="text-sm text-admin-ink-soft">Nada programado.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entregas.map((entrega, i) => (
            <li key={`${entrega.folio}-${i}`} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate text-admin-ink">{entrega.negocioNombre}</span>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-semibold text-admin-ink">{entrega.cantidad} pzas</span>
                <FolioLink folio={entrega.folio} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PendientesMasAntiguos({
  pendientes,
}: {
  pendientes: { id: string; folio: string; negocioNombre: string; diasPendiente: number }[];
}) {
  return (
    <Card className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-admin-ink-soft">Pendientes de confirmación más antiguos</span>
      {pendientes.length === 0 ? (
        <p className="text-sm text-admin-ink-soft">No hay pedidos pendientes de confirmación.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pendientes.map((pendiente) => (
            <li
              key={pendiente.id}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-admin-control)] bg-amber-50 px-3 py-2 text-sm"
            >
              <span className="truncate text-admin-ink">{pendiente.negocioNombre}</span>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-semibold text-amber-800">
                  {pendiente.diasPendiente} {pendiente.diasPendiente === 1 ? "día" : "días"}
                </span>
                <FolioLink folio={pendiente.folio} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
