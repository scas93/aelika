"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  avanzarOrder,
  fetchOrders,
  fetchPuntosEnvio,
  fetchTenantSettings,
  reembolsarOrder,
  METODO_PAGO_LABEL,
  type Order,
} from "@/lib/api";
import {
  cabeEnUnaLinea,
  COLUMNS_BODY,
  entregaLinea,
  formatFechaHora,
  isWebUsbSupported,
  precioLineaItem,
  printComandaWebUsb,
  ROLE_LABEL,
  type ComandaContext,
} from "@/lib/thermal-printer";
import { regimenFiscalLabel, usoCfdiLabel } from "@/lib/catalogos-sat";
import { rangoHoyISO } from "@/lib/fecha";
import { ESTADO_COLOR, ESTADO_LABEL, ESTADO_PAGO_COLOR, ESTADO_PAGO_LABEL, SIGUIENTE_ESTADO } from "./estado";
import Card from "../_components/Card";
import Button from "../_components/Button";
import Badge from "../_components/Badge";
import Modal from "../_components/Modal";

const POLL_INTERVAL_MS = 25000;

type Tab = "activos" | "entregados";

export default function PedidosPage() {
  const { token } = useSession();
  const [activos, setActivos] = useState<Order[] | null>(null);
  const [entregadosHoy, setEntregadosHoy] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("activos");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [nombreNegocio, setNombreNegocio] = useState("");
  const [ubicacionNegocio, setUbicacionNegocio] = useState<string | null>(null);
  const [puntosEnvioMap, setPuntosEnvioMap] = useState<Record<string, string>>({});

  async function load() {
    try {
      const { desde, hasta } = rangoHoyISO();
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
    // Needed to print the business name and address on the comanda.
    fetchTenantSettings(token)
      .then((settings) => {
        setNombreNegocio(settings.nombre);
        setUbicacionNegocio(settings.ubicacion);
      })
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
        <Button variant={tab === "activos" ? "primary" : "secondary"} onClick={() => setTab("activos")}>
          Activos {activos ? `(${activos.length})` : ""}
        </Button>
        <Button variant={tab === "entregados" ? "primary" : "secondary"} onClick={() => setTab("entregados")}>
          Entregados hoy {entregadosHoy ? `(${entregadosHoy.length})` : ""}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {shown === null ? (
        <p className="text-sm text-admin-ink-soft">Cargando...</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.length === 0 && (
            <li>
              <Card className="text-sm text-admin-ink-soft">
                {tab === "activos" ? "No hay pedidos activos." : "No hay pedidos entregados hoy."}
              </Card>
            </li>
          )}
          {shown.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              expanded={expandedId === order.id}
              onToggle={() => setExpandedId((current) => (current === order.id ? null : order.id))}
              nombreNegocio={nombreNegocio}
              ubicacionNegocio={ubicacionNegocio}
              nombrePuntoEnvio={order.puntoEnvioId ? puntosEnvioMap[order.puntoEnvioId] : undefined}
              onAdvanced={load}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderCard({
  order,
  expanded,
  onToggle,
  nombreNegocio,
  ubicacionNegocio,
  nombrePuntoEnvio,
  onAdvanced,
}: {
  order: Order;
  expanded: boolean;
  onToggle: () => void;
  nombreNegocio: string;
  ubicacionNegocio: string | null;
  nombrePuntoEnvio: string | undefined;
  onAdvanced: () => void;
}) {
  const { token, user } = useSession();
  const [advancing, setAdvancing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [confirmReembolsoOpen, setConfirmReembolsoOpen] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);
  // Defaults to true so SSR and the first client render match (navigator.usb
  // isn't available during SSR) — the effect below corrects it right after.
  const [webUsbSupported, setWebUsbSupported] = useState(true);
  // Updated via flushSync right before window.print() (see the "Imprimir con
  // el navegador" button below) so the hidden ComandaImprimible reflects the
  // actual moment of printing, not whenever this card last happened to
  // re-render — window.print() reads the DOM synchronously, before React's
  // normal (batched, async) re-render would otherwise land.
  const [fechaImpresion, setFechaImpresion] = useState<Date>(() => new Date());

  const comandaCtx: ComandaContext = {
    nombreNegocio,
    ubicacionNegocio,
    nombrePuntoEnvio,
    impresoPor: { nombre: user.nombre, rol: user.rol },
  };

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

  async function handleReembolsar() {
    setRefunding(true);
    setRefundError(null);
    try {
      await reembolsarOrder(token, order.id);
      setConfirmReembolsoOpen(false);
      onAdvanced();
    } catch (err) {
      setRefundError(err instanceof ApiError ? err.message : "No se pudo procesar la devolución");
    } finally {
      setRefunding(false);
    }
  }

  async function handleImprimirWebUsb() {
    setPrinting(true);
    setPrintError(null);
    try {
      await printComandaWebUsb(order, comandaCtx);
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
    <li>
      <Card padding={20}>
        <button onClick={onToggle} className="flex w-full items-center justify-between gap-3 text-left">
          <div className="flex items-center gap-3">
            <span className="text-admin-ink-soft">{expanded ? "▼" : "▶"}</span>
            <span className="text-base font-bold text-admin-ink">#{order.folio}</span>
            <span className="text-sm text-admin-ink-soft">{fecha}</span>
          </div>
          <div className="flex items-center gap-2">
            {order.estadoPago === "REEMBOLSADO" && (
              <Badge color={ESTADO_PAGO_COLOR.REEMBOLSADO!}>{ESTADO_PAGO_LABEL.REEMBOLSADO}</Badge>
            )}
            <Badge color={ESTADO_COLOR[order.estadoPedido]}>{ESTADO_LABEL[order.estadoPedido]}</Badge>
          </div>
        </button>

        {expanded && (
          <div className="mt-3 flex flex-col gap-3 border-t border-admin-border pt-3">
            <div className="text-[15px] text-admin-ink">
              <span className="font-bold">{order.clienteNombre}</span>{" "}
              <span className="text-admin-ink-soft">· {order.clienteTelefono}</span>
            </div>

            {order.notas && (
              <p className="rounded-[var(--radius-admin-control)] bg-admin-bg p-3 text-sm text-admin-ink">
                📝 {order.notas}
              </p>
            )}

            <ul className="flex flex-col">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between py-2 text-[15px] text-admin-ink">
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

            <div className="flex items-center justify-between border-t border-admin-border pt-2">
              <span className="text-base font-bold text-admin-ink">Total</span>
              <span className="text-lg font-bold text-admin-ink">${Number(order.total).toFixed(2)}</span>
            </div>

            <p className="text-sm text-admin-ink-soft">
              {entregaLinea(order, nombrePuntoEnvio)}
              {order.metodoEntrega === "RECOGER" && ` · ${horaRecogidaDisplay}`} · Pago:{" "}
              {METODO_PAGO_LABEL[order.metodoPago] ?? order.metodoPago}
            </p>

            {order.requiereFactura && (
              <div className="flex flex-col gap-1 rounded-[var(--radius-admin-control)] bg-admin-bg p-3 text-sm text-admin-ink">
                <span className="text-xs font-bold uppercase tracking-wide text-admin-ink-soft">Datos fiscales</span>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <span className="text-admin-ink-soft">Razón social</span>
                  <span className="font-medium">{order.facturaRazonSocial}</span>
                  <span className="text-admin-ink-soft">RFC</span>
                  <span className="font-medium">{order.facturaRfc}</span>
                  <span className="text-admin-ink-soft">Régimen fiscal</span>
                  <span className="font-medium">{regimenFiscalLabel(order.facturaRegimenFiscal)}</span>
                  <span className="text-admin-ink-soft">Uso de CFDI</span>
                  <span className="font-medium">{usoCfdiLabel(order.facturaUsoCfdi)}</span>
                  <span className="text-admin-ink-soft">C.P. fiscal</span>
                  <span className="font-medium">{order.facturaCodigoPostal}</span>
                  <span className="text-admin-ink-soft">Correo</span>
                  <span className="font-medium">{order.facturaCorreo}</span>
                </div>
              </div>
            )}

            {actionError && <p className="text-sm text-red-600">{actionError}</p>}
            {refundError && <p className="text-sm text-red-600">{refundError}</p>}
            {printError && (
              <p className="text-sm text-red-600">
                {printError}{" "}
                <button onClick={handleImprimirWebUsb} className="underline">
                  Reintentar
                </button>
              </p>
            )}

            <div className="flex flex-col gap-1.5 border-t border-admin-border pt-3">
              <div className="flex flex-wrap items-center gap-2">
                {siguienteEstado && (
                  <Button variant="primary" onClick={handleAvanzar} disabled={advancing}>
                    {advancing ? "Avanzando..." : `Avanzar a: ${ESTADO_LABEL[siguienteEstado]}`}
                  </Button>
                )}
                <Button variant="secondary" onClick={handleImprimirWebUsb} disabled={printing || !webUsbSupported}>
                  {printing ? "Imprimiendo..." : "Imprimir ticket"}
                </Button>
                {order.metodoPago === "TARJETA" && order.estadoPago === "PAGADO" && (
                  <Button variant="danger" onClick={() => setConfirmReembolsoOpen(true)}>
                    Reembolsar
                  </Button>
                )}
                <button
                  onClick={() => {
                    flushSync(() => setFechaImpresion(new Date()));
                    window.print();
                  }}
                  className="rounded-full px-3 py-1.5 text-sm font-medium text-admin-ink-soft underline-offset-2 transition hover:underline"
                >
                  Imprimir con el navegador
                </button>
              </div>
              {!webUsbSupported && (
                <p className="text-sm text-admin-ink-soft">
                  &quot;Imprimir ticket&quot; requiere Chrome o Edge — usa &quot;Imprimir con el navegador&quot; en su
                  lugar.
                </p>
              )}
            </div>
          </div>
        )}
      </Card>

      {expanded && <ComandaImprimible order={order} ctx={comandaCtx} fechaImpresion={fechaImpresion} />}

      <Modal
        open={confirmReembolsoOpen}
        onClose={() => {
          if (!refunding) setConfirmReembolsoOpen(false);
        }}
        title={`Reembolsar pedido #${order.folio}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReembolsoOpen(false)} disabled={refunding}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleReembolsar} disabled={refunding}>
              {refunding ? "Procesando..." : "Sí, reembolsar"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-admin-ink-soft">
          Se devolverá el total de ${Number(order.total).toFixed(2)} a la tarjeta del cliente. Esta acción no se puede
          deshacer.
        </p>
      </Modal>
    </li>
  );
}

function ComandaImprimible({
  order,
  ctx,
  fechaImpresion,
}: {
  order: Order;
  ctx: ComandaContext;
  fechaImpresion: Date;
}) {
  const horaRecogidaDisplay =
    order.horaRecogidaTipo === "HORA_ESPECIFICA" && order.horaRecogida ? `Recoge: ${order.horaRecogida}` : "Lo antes posible";

  return (
    <div id="comanda-imprimible" className="hidden print:block">
      <p className="text-center text-lg font-bold">{ctx.nombreNegocio}</p>
      {ctx.ubicacionNegocio && <p className="text-center text-sm">{ctx.ubicacionNegocio}</p>}
      <p className="text-center text-3xl font-bold">#{order.folio}</p>
      <p className="text-center text-xl font-semibold">
        {order.metodoEntrega === "DOMICILIO" ? "A domicilio" : horaRecogidaDisplay}
      </p>
      <hr className="my-2 border-black" />
      <p className="text-sm font-bold">{entregaLinea(order, ctx.nombrePuntoEnvio)}</p>
      <p className="text-sm">{order.clienteNombre}</p>
      <p className="text-sm">{order.clienteTelefono}</p>
      <hr className="my-2 border-black" />
      <p className="text-sm">Pedido: {formatFechaHora(new Date(order.createdAt))}</p>
      <hr className="my-2 border-black" />
      <ul className="flex flex-col gap-1">
        {order.items.map((item) => {
          const nombreLinea = `${item.cantidad}× ${item.nombreProducto}`;
          const precioTexto = precioLineaItem(item);
          return (
            <li key={item.id} className="text-sm font-bold">
              {cabeEnUnaLinea(nombreLinea, precioTexto, COLUMNS_BODY) ? (
                <div className="flex justify-between gap-2">
                  <span>{nombreLinea}</span>
                  <span>{precioTexto}</span>
                </div>
              ) : (
                <>
                  <p>{nombreLinea}</p>
                  <p className="text-right">{precioTexto}</p>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {order.notas && (
        <div className="mt-1 border-2 border-black p-2">
          <p className="text-xs font-bold uppercase">Notas</p>
          <p className="text-lg font-bold">{order.notas}</p>
        </div>
      )}
      <hr className="my-2 border-black" />
      <div className="flex justify-between text-sm">
        <span>{METODO_PAGO_LABEL[order.metodoPago] ?? order.metodoPago}</span>
        <span>${Number(order.total).toFixed(2)}</span>
      </div>
      {Number(order.descuentoTotal) > 0 && (
        <p className="text-sm">Descuento: -${Number(order.descuentoTotal).toFixed(2)}</p>
      )}
      <p className="text-lg font-bold">Total: ${Number(order.total).toFixed(2)}</p>

      {order.requiereFactura && (
        <div className="mt-1 border-2 border-black p-2">
          <p className="text-xs font-bold uppercase">Datos fiscales</p>
          <p className="text-sm">Razón social: {order.facturaRazonSocial}</p>
          <p className="text-sm">RFC: {order.facturaRfc}</p>
          <p className="text-sm">Régimen fiscal: {regimenFiscalLabel(order.facturaRegimenFiscal)}</p>
          <p className="text-sm">Uso de CFDI: {usoCfdiLabel(order.facturaUsoCfdi)}</p>
          <p className="text-sm">C.P. fiscal: {order.facturaCodigoPostal}</p>
          <p className="text-sm">Correo: {order.facturaCorreo}</p>
        </div>
      )}

      <hr className="my-2 border-black" />
      <p className="text-xs">
        Impreso por: {ctx.impresoPor.nombre} ({ROLE_LABEL[ctx.impresoPor.rol]})
      </p>
      <p className="text-xs">Fecha de impresión: {formatFechaHora(fechaImpresion)}</p>
      <p className="text-center text-sm font-semibold">Gracias por su preferencia</p>
    </div>
  );
}
