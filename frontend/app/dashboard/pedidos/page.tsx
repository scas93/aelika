"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  avanzarOrder,
  fetchOrders,
  fetchPuntosEnvio,
  fetchTenantSettings,
  METODO_PAGO_LABEL,
  type Order,
} from "@/lib/api";
import { entregaLinea, isWebUsbSupported, printComandaWebUsb } from "@/lib/thermal-printer";
import { regimenFiscalLabel, usoCfdiLabel } from "@/lib/catalogos-sat";
import { ESTADO_COLOR, ESTADO_LABEL, SIGUIENTE_ESTADO } from "./estado";

const POLL_INTERVAL_MS = 25000;

type Tab = "activos" | "entregados";

function hoyYYYYMMDD(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function PedidosPage() {
  const { token } = useSession();
  const [activos, setActivos] = useState<Order[] | null>(null);
  const [entregadosHoy, setEntregadosHoy] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("activos");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [nombreNegocio, setNombreNegocio] = useState("");
  const [puntosEnvioMap, setPuntosEnvioMap] = useState<Record<string, string>>({});

  async function load() {
    try {
      // Same desde/hasta construction the old Desde/Hasta date filter used
      // (a "YYYY-MM-DD" string run through new Date(str).toISOString()),
      // just auto-filled to today instead of user-picked — see CLAUDE.md.
      const hoy = hoyYYYYMMDD();
      const desde = new Date(hoy).toISOString();
      const hasta = new Date(`${hoy}T23:59:59.999`).toISOString();
      const [todos, despachadosHoy] = await Promise.all([
        fetchOrders(token, {}),
        fetchOrders(token, { estadoPedido: "DESPACHADO", desde, hasta }),
      ]);
      setActivos(todos.filter((o) => o.estadoPedido !== "DESPACHADO"));
      setEntregadosHoy(despachadosHoy);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los pedidos");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch + poll on an interval
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Needed to print the business name on the comanda.
    fetchTenantSettings(token)
      .then((settings) => setNombreNegocio(settings.nombre))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    // Order only stores puntoEnvioId (no name snapshot — see CLAUDE.md), so
    // the panel resolves the delivery zone name from this lookup instead.
    // Open to all 3 roles, same as this page itself.
    fetchPuntosEnvio(token)
      .then((puntos) => setPuntosEnvioMap(Object.fromEntries(puntos.map((p) => [p.id, p.nombre]))))
      .catch(() => {});
  }, [token]);

  const shown = tab === "activos" ? activos : entregadosHoy;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-2">
        <TabButton active={tab === "activos"} onClick={() => setTab("activos")}>
          Activos {activos ? `(${activos.length})` : ""}
        </TabButton>
        <TabButton active={tab === "entregados"} onClick={() => setTab("entregados")}>
          Entregados hoy {entregadosHoy ? `(${entregadosHoy.length})` : ""}
        </TabButton>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {shown === null ? (
        <p className="text-sm text-admin-ink/55">Cargando...</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.length === 0 && (
            <li className="rounded-[10px] bg-white p-4 text-sm text-admin-ink/55 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
              {tab === "activos" ? "No hay pedidos activos." : "No hay pedidos entregados hoy."}
            </li>
          )}
          {shown.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              expanded={expandedId === order.id}
              onToggle={() => setExpandedId((current) => (current === order.id ? null : order.id))}
              nombreNegocio={nombreNegocio}
              nombrePuntoEnvio={order.puntoEnvioId ? puntosEnvioMap[order.puntoEnvioId] : undefined}
              onAdvanced={load}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "rounded-lg bg-admin-green px-4 py-2 text-sm font-bold text-white"
          : "rounded-lg border border-black/10 bg-white px-4 py-2 text-sm font-bold text-admin-ink/70 transition hover:bg-admin-bg"
      }
    >
      {children}
    </button>
  );
}

function OrderCard({
  order,
  expanded,
  onToggle,
  nombreNegocio,
  nombrePuntoEnvio,
  onAdvanced,
}: {
  order: Order;
  expanded: boolean;
  onToggle: () => void;
  nombreNegocio: string;
  nombrePuntoEnvio: string | undefined;
  onAdvanced: () => void;
}) {
  const { token } = useSession();
  const [advancing, setAdvancing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  // Defaults to true so SSR and the first client render match (navigator.usb
  // isn't available during SSR) — the effect below corrects it right after.
  const [webUsbSupported, setWebUsbSupported] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time browser capability check
    setWebUsbSupported(isWebUsbSupported());
  }, []);

  async function handleAvanzar() {
    setAdvancing(true);
    setActionError(null);
    try {
      await avanzarOrder(token, order.id);
      onAdvanced();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "No se pudo avanzar el pedido");
    } finally {
      setAdvancing(false);
    }
  }

  async function handleImprimirWebUsb() {
    setPrinting(true);
    setPrintError(null);
    try {
      await printComandaWebUsb(order, nombreNegocio, nombrePuntoEnvio);
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : "No se pudo imprimir la comanda");
    } finally {
      setPrinting(false);
    }
  }

  const horaRecogidaDisplay =
    order.horaRecogidaTipo === "HORA_ESPECIFICA" && order.horaRecogida ? order.horaRecogida : "Lo antes posible";
  const fecha = new Date(order.createdAt).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const siguienteEstado = SIGUIENTE_ESTADO[order.estadoPedido];

  return (
    <li className="rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="flex items-center gap-3">
          <span className="text-admin-ink/50">{expanded ? "▼" : "▶"}</span>
          <span className="text-sm font-bold text-admin-ink">#{order.folio}</span>
          <span className="text-xs text-admin-ink/55">{fecha}</span>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold text-white ${ESTADO_COLOR[order.estadoPedido]}`}>
          {ESTADO_LABEL[order.estadoPedido]}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 border-t border-black/10 px-4 py-3">
          <div className="text-sm text-admin-ink">
            <span className="font-bold">{order.clienteNombre}</span> · {order.clienteTelefono}
          </div>

          {order.notas && (
            <p className="rounded-md bg-admin-bg px-2.5 py-2 text-sm text-admin-ink">📝 {order.notas}</p>
          )}

          <ul className="flex flex-col gap-1.5">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between text-sm text-admin-ink">
                <span>
                  {item.cantidad}× {item.nombreProducto}
                </span>
                <span>${(Number(item.precioUnitario) * item.cantidad).toFixed(2)}</span>
              </li>
            ))}
          </ul>

          {Number(order.descuentoTotal) > 0 && (
            <div className="flex items-center justify-between text-sm text-admin-green-dark">
              <span>{order.notasDescuento ?? "Descuento aplicado"}</span>
              <span>-${Number(order.descuentoTotal).toFixed(2)}</span>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-black/10 pt-2 text-sm font-bold text-admin-ink">
            <span>Total</span>
            <span>${Number(order.total).toFixed(2)}</span>
          </div>

          <p className="text-xs text-admin-ink/55">
            {entregaLinea(order, nombrePuntoEnvio)}
            {order.metodoEntrega === "RECOGER" && ` · ${horaRecogidaDisplay}`} · Pago:{" "}
            {METODO_PAGO_LABEL[order.metodoPago] ?? order.metodoPago}
          </p>

          {order.requiereFactura && (
            <div className="flex flex-col gap-1 rounded-md bg-admin-bg px-2.5 py-2 text-sm text-admin-ink">
              <span className="text-xs font-bold uppercase tracking-wide text-admin-ink/55">Datos fiscales</span>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <span className="text-admin-ink/55">Razón social</span>
                <span className="font-medium">{order.facturaRazonSocial}</span>
                <span className="text-admin-ink/55">RFC</span>
                <span className="font-medium">{order.facturaRfc}</span>
                <span className="text-admin-ink/55">Régimen fiscal</span>
                <span className="font-medium">{regimenFiscalLabel(order.facturaRegimenFiscal)}</span>
                <span className="text-admin-ink/55">Uso de CFDI</span>
                <span className="font-medium">{usoCfdiLabel(order.facturaUsoCfdi)}</span>
                <span className="text-admin-ink/55">C.P. fiscal</span>
                <span className="font-medium">{order.facturaCodigoPostal}</span>
                <span className="text-admin-ink/55">Correo</span>
                <span className="font-medium">{order.facturaCorreo}</span>
              </div>
            </div>
          )}

          {actionError && <p className="text-sm text-red-600">{actionError}</p>}
          {printError && (
            <p className="text-sm text-red-600">
              {printError}{" "}
              <button onClick={handleImprimirWebUsb} className="underline">
                Reintentar
              </button>
            </p>
          )}

          <div className="flex flex-col gap-1.5 border-t border-black/10 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              {siguienteEstado && (
                <button
                  onClick={handleAvanzar}
                  disabled={advancing}
                  className="rounded-lg bg-admin-green px-4 py-2 text-sm font-bold text-white transition hover:bg-admin-green-dark disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {advancing ? "Avanzando..." : `Avanzar a: ${ESTADO_LABEL[siguienteEstado]}`}
                </button>
              )}
              <button
                onClick={handleImprimirWebUsb}
                disabled={printing || !webUsbSupported}
                className="rounded-lg border border-black/10 bg-white px-4 py-2 text-sm font-bold text-admin-ink transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-40"
              >
                {printing ? "Imprimiendo..." : "Imprimir ticket"}
              </button>
              <button
                onClick={() => window.print()}
                className="rounded-full px-3 py-1.5 text-xs font-medium text-admin-ink/55 underline-offset-2 transition hover:underline"
              >
                Imprimir con el navegador
              </button>
            </div>
            {!webUsbSupported && (
              <p className="text-xs text-admin-ink/55">
                &quot;Imprimir ticket&quot; requiere Chrome o Edge — usa &quot;Imprimir con el navegador&quot; en su
                lugar.
              </p>
            )}
          </div>
        </div>
      )}

      {expanded && <ComandaImprimible order={order} nombrePuntoEnvio={nombrePuntoEnvio} />}
    </li>
  );
}

function ComandaImprimible({ order, nombrePuntoEnvio }: { order: Order; nombrePuntoEnvio: string | undefined }) {
  const horaRecogidaDisplay =
    order.horaRecogidaTipo === "HORA_ESPECIFICA" && order.horaRecogida ? `Recoge: ${order.horaRecogida}` : "Lo antes posible";

  return (
    <div id="comanda-imprimible" className="hidden print:block">
      <p className="text-center text-3xl font-bold">#{order.folio}</p>
      <p className="text-center text-xl font-semibold">
        {order.metodoEntrega === "DOMICILIO" ? "A domicilio" : horaRecogidaDisplay}
      </p>
      <p className="text-center text-lg font-bold">{entregaLinea(order, nombrePuntoEnvio)}</p>
      <hr className="my-2 border-black" />
      <p className="text-sm">{order.clienteNombre}</p>
      <p className="text-sm">{order.clienteTelefono}</p>
      <hr className="my-2 border-black" />
      <ul className="flex flex-col gap-1.5">
        {order.items.map((item) => (
          <li key={item.id} className="text-2xl font-bold leading-tight">
            {item.cantidad}× {item.nombreProducto}
          </li>
        ))}
      </ul>
      {order.notas && (
        <div className="mt-3 border-2 border-black p-2">
          <p className="text-xs font-bold uppercase">Notas</p>
          <p className="text-lg font-bold">{order.notas}</p>
        </div>
      )}
      <hr className="my-2 border-black" />
      <p className="text-sm">{METODO_PAGO_LABEL[order.metodoPago] ?? order.metodoPago}</p>
      {Number(order.descuentoTotal) > 0 && (
        <p className="text-sm">Descuento: -${Number(order.descuentoTotal).toFixed(2)}</p>
      )}
      <p className="text-lg font-bold">Total: ${Number(order.total).toFixed(2)}</p>

      {order.requiereFactura && (
        <div className="mt-3 border-2 border-black p-2">
          <p className="text-xs font-bold uppercase">Datos fiscales</p>
          <p className="text-sm">Razón social: {order.facturaRazonSocial}</p>
          <p className="text-sm">RFC: {order.facturaRfc}</p>
          <p className="text-sm">Régimen fiscal: {regimenFiscalLabel(order.facturaRegimenFiscal)}</p>
          <p className="text-sm">Uso de CFDI: {usoCfdiLabel(order.facturaUsoCfdi)}</p>
          <p className="text-sm">C.P. fiscal: {order.facturaCodigoPostal}</p>
          <p className="text-sm">Correo: {order.facturaCorreo}</p>
        </div>
      )}
    </div>
  );
}
