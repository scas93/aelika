"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  fetchClientes,
  fetchClientesActivos,
  fetchClientesSummaryDaily,
  fetchOrdersSummary,
  fetchOrdersSummaryDaily,
  fetchOrdersSummaryPorEstatus,
  type Cliente,
  type ClientesPorDia,
  type OrderSummary,
  type OrdersPorDia,
  type OrdersPorEstatus,
} from "@/lib/api";
import { rangoHoyISO } from "@/lib/fecha";
import Card from "./_components/Card";
import SummaryCard from "./_components/SummaryCard";
import Badge from "./_components/Badge";
import { ESTADO_VARIANT, ESTADO_LABEL, ESTADOS } from "./pedidos/estado";
import InicioB2B from "./inicio-b2b";

const MONEY_FORMATTER = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

function formatMoney(value: string): string {
  return MONEY_FORMATTER.format(Number(value));
}

// "fecha" is a plain YYYY-MM-DD calendar date (see OrdersService.summaryDaily) —
// parsed and formatted as UTC so the browser's local timezone never shifts it
// to the neighboring day.
function formatFechaCorta(fecha: string): string {
  return new Date(`${fecha}T00:00:00Z`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export default function DashboardPage() {
  const { user } = useSession();

  // Gate antes del branch B2B/B2C a propósito — Operador no ve el
  // Dashboard en ninguna de las dos variantes (ver nav-items.ts, donde el
  // link "Inicio" ya se oculta para Operador sin importar tipoStorefront).
  // Poniéndolo aquí, ni InicioB2B ni InicioB2C necesitan su propio chequeo
  // de rol — mismo mensaje/patrón que clientes/page.tsx y ajustes/page.tsx.
  if (user.rol !== "GERENTE" && user.rol !== "DUENO") {
    return <p className="text-sm text-admin-ink-soft">No tienes permiso para ver esta sección.</p>;
  }

  // B2C queda exactamente igual a como estaba (InicioB2C, sin cambios) —
  // B2B consume un agregado distinto (GET /pedidos-b2b/resumen, ver
  // inicio-b2b.tsx), Order/summary no le aplica.
  if (user.tenant.tipoStorefront === "RETAIL_B2B") {
    return <InicioB2B />;
  }

  return <InicioB2C />;
}

function InicioB2C() {
  const { token } = useSession();
  const [summary, setSummary] = useState<OrderSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [daily, setDaily] = useState<OrdersPorDia[] | null>(null);
  const [dailyError, setDailyError] = useState<string | null>(null);

  const [clientesActivos, setClientesActivos] = useState<number | null>(null);
  const [clientesActivosError, setClientesActivosError] = useState<string | null>(null);
  const [clientesDaily, setClientesDaily] = useState<ClientesPorDia[] | null>(null);
  const [clientesDailyError, setClientesDailyError] = useState<string | null>(null);
  const [topClientes, setTopClientes] = useState<Cliente[] | null>(null);
  const [topClientesError, setTopClientesError] = useState<string | null>(null);
  const [porEstatus, setPorEstatus] = useState<OrdersPorEstatus[] | null>(null);
  const [porEstatusError, setPorEstatusError] = useState<string | null>(null);

  useEffect(() => {
    const rango = rangoHoyISO();

    fetchOrdersSummary(token, rango)
      .then(setSummary)
      .catch((err) => {
        setSummaryError(err instanceof ApiError ? err.message : "No se pudo cargar el resumen");
      });

    fetchOrdersSummaryDaily(token, rango)
      .then(setDaily)
      .catch((err) => {
        setDailyError(err instanceof ApiError ? err.message : "No se pudo cargar la gráfica");
      });

    fetchClientesActivos(token)
      .then((res) => setClientesActivos(res.clientesActivos))
      .catch((err) => {
        setClientesActivosError(err instanceof ApiError ? err.message : "No se pudo cargar el dato");
      });

    fetchClientesSummaryDaily(token, rango)
      .then(setClientesDaily)
      .catch((err) => {
        setClientesDailyError(err instanceof ApiError ? err.message : "No se pudo cargar la gráfica");
      });

    // Top clientes reutiliza el directorio paginado existente (mismo
    // ordenarPor=totalPedidos que ya soporta /dashboard/clientes) — no hay
    // un endpoint de agregación aparte para esto, ver CLAUDE.md.
    fetchClientes(token, { ordenarPor: "totalPedidos", orden: "desc", limit: 5 })
      .then((res) => setTopClientes(res.data))
      .catch((err) => {
        setTopClientesError(err instanceof ApiError ? err.message : "No se pudo cargar el ranking");
      });

    fetchOrdersSummaryPorEstatus(token, rango)
      .then(setPorEstatus)
      .catch((err) => {
        setPorEstatusError(err instanceof ApiError ? err.message : "No se pudo cargar el desglose");
      });
  }, [token]);

  const chartData = daily?.map((d) => ({ ...d, label: formatFechaCorta(d.fecha) }));
  const clientesChartData = clientesDaily?.map((d) => ({ ...d, label: formatFechaCorta(d.fecha) }));
  const porEstatusOrdenado = porEstatus
    ? ESTADOS.map((estado) => porEstatus.find((p) => p.estadoPedido === estado)).filter(
        (p): p is OrdersPorEstatus => !!p,
      )
    : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <SummaryCard label="Pedidos hoy" value={summary?.pedidosHoy} error={summaryError} />
        <SummaryCard label="Ingresos hoy" value={summary ? formatMoney(summary.ingresosHoy) : undefined} error={summaryError} />
        <SummaryCard
          label="Ticket promedio"
          value={summary ? formatMoney(summary.ticketPromedioHoy) : undefined}
          error={summaryError}
        />
        <SummaryCard label="Promociones activas" value={summary?.promocionesActivas} error={summaryError} />
        <SummaryCard label="Clientes activos (7 días)" value={clientesActivos ?? undefined} error={clientesActivosError} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-4">
          <span className="text-[13px] font-semibold text-admin-ink-soft">Pedidos — últimos 10 días</span>
          {dailyError ? (
            <p className="text-sm text-red-600">No se pudo cargar la gráfica</p>
          ) : !chartData ? (
            <p className="text-sm text-admin-ink-soft">Cargando...</p>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-admin-border)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12, fill: "var(--color-admin-ink-soft)" }}
                    axisLine={{ stroke: "var(--color-admin-border)" }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: "var(--color-admin-ink-soft)" }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--color-admin-bg)" }}
                    formatter={(value) => [value, "Pedidos"]}
                    labelStyle={{ color: "var(--color-admin-ink)" }}
                  />
                  <Bar dataKey="pedidos" fill="var(--color-admin-accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-4">
          <span className="text-[13px] font-semibold text-admin-ink-soft">Clientes nuevos vs. recurrentes — últimos 10 días</span>
          {clientesDailyError ? (
            <p className="text-sm text-red-600">No se pudo cargar la gráfica</p>
          ) : !clientesChartData ? (
            <p className="text-sm text-admin-ink-soft">Cargando...</p>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={clientesChartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-admin-border)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 12, fill: "var(--color-admin-ink-soft)" }}
                    axisLine={{ stroke: "var(--color-admin-border)" }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: "var(--color-admin-ink-soft)" }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip cursor={{ fill: "var(--color-admin-bg)" }} labelStyle={{ color: "var(--color-admin-ink)" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="nuevos"
                    name="Nuevos"
                    stackId="clientes"
                    fill="var(--color-admin-accent)"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="recurrentes"
                    name="Recurrentes"
                    stackId="clientes"
                    fill="var(--color-admin-ink-soft)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-admin-ink-soft">Top clientes</span>
          {topClientesError ? (
            <p className="text-sm text-red-600">{topClientesError}</p>
          ) : !topClientes ? (
            <p className="text-sm text-admin-ink-soft">Cargando...</p>
          ) : topClientes.length === 0 ? (
            <p className="text-sm text-admin-ink-soft">Todavía no hay clientes registrados.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {topClientes.map((cliente, i) => (
                <li key={cliente.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-admin-ink">
                    <span className="text-admin-ink-soft">{i + 1}.</span>
                    {cliente.nombre}
                  </span>
                  <span className="font-semibold text-admin-ink">{cliente.totalPedidos} pedidos</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-admin-ink-soft">Pedidos por estatus — hoy</span>
          {porEstatusError ? (
            <p className="text-sm text-red-600">{porEstatusError}</p>
          ) : !porEstatusOrdenado ? (
            <p className="text-sm text-admin-ink-soft">Cargando...</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {porEstatusOrdenado.map((p) => (
                <li key={p.estadoPedido} className="flex items-center justify-between gap-3 text-sm">
                  <Badge variant={ESTADO_VARIANT[p.estadoPedido]}>{ESTADO_LABEL[p.estadoPedido]}</Badge>
                  <span className="font-semibold text-admin-ink">{p.conteo}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
