"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useSession } from "@/lib/session-context";
import { ApiError, fetchOrdersSummary, fetchOrdersSummaryDaily, type OrderSummary, type OrdersPorDia } from "@/lib/api";
import { rangoHoyISO } from "@/lib/fecha";
import Card from "./_components/Card";
import SummaryCard from "./_components/SummaryCard";
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
  }, [token]);

  const chartData = daily?.map((d) => ({ ...d, label: formatFechaCorta(d.fecha) }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <SummaryCard label="Pedidos hoy" value={summary?.pedidosHoy} error={summaryError} />
        <SummaryCard label="Ingresos hoy" value={summary ? formatMoney(summary.ingresosHoy) : undefined} error={summaryError} />
        <SummaryCard
          label="Ticket promedio"
          value={summary ? formatMoney(summary.ticketPromedioHoy) : undefined}
          error={summaryError}
        />
        <SummaryCard label="Promociones activas" value={summary?.promocionesActivas} error={summaryError} />
      </div>

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
                <Bar dataKey="pedidos" fill="var(--color-admin-green)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}
