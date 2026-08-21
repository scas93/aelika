"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  createPublicOrder,
  fetchPublicPuntosEnvio,
  type FacturacionModo,
  type HoraRecogidaTipo,
  type HorarioSemana,
  type MetodoEntrega,
  type PublicOrder,
  type PublicPuntoEnvio,
} from "@/lib/api";
import { horaActualMexico, horarioDeHoy, generarOpcionesHora, sumarMinutos } from "@/lib/horario";
import { REGIMEN_FISCAL, USO_CFDI } from "@/lib/catalogos-sat";

export interface CartItemModifier {
  modifierOptionId: string;
  nombre: string;
  precioAdicional: number;
}

export interface CartItem {
  // Line id, independent of productId — two lines for the same product with
  // different modifier selections can't be merged into one by summing
  // cantidad the way plain products (no modifiers) can, so each line needs
  // its own identity. Generated client-side (crypto.randomUUID()) when the
  // line is created; never sent to the backend.
  id: string;
  productId: string;
  nombre: string;
  precioUnitario: number;
  cantidad: number;
  // Snapshot of the selected options (nombre/precioAdicional), so the cart
  // summary can render them without looking the product back up.
  modifiers: CartItemModifier[];
}

// Same shape as CartItem, plus the pre-discount list price — used to render
// the payment summary in the "pago" step (subtotal/descuento breakdown).
// Computed by page.tsx (it already has catalog + precioConDescuento in
// scope); this component only displays it, never recomputes pricing.
export interface ResumenItem extends CartItem {
  precioOriginal: number;
}

type Step = "cart" | "entrega" | "datos" | "pago" | "confirmation";

const MARGEN_MINIMO_MINUTOS = 15;

const TOGGLE_ACTIVE =
  "rounded-lg border-2 border-black bg-black/5 px-3 py-1.5 text-xs font-semibold text-black dark:border-white dark:bg-white/10 dark:text-white";
const TOGGLE_INACTIVE =
  "rounded-lg border-2 border-black/15 px-3 py-1.5 text-xs font-medium text-black/60 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:text-white/60 dark:hover:bg-white/10";
const BTN_PRIMARY =
  "rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black";
const BACK_LINK = "text-sm text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white";
const RESUMEN_BOX = "flex flex-col gap-2 rounded-xl bg-black/[0.03] p-3 dark:bg-white/5";
const RESUMEN_LABEL = "text-xs font-semibold uppercase tracking-wide text-black/40 dark:text-white/40";

export default function CheckoutModal({
  slug,
  items,
  total,
  resumenItems,
  abierto,
  horario,
  facturacionModo,
  onChangeQty,
  onClose,
  onSuccess,
}: {
  slug: string;
  items: CartItem[];
  total: number;
  resumenItems: ResumenItem[];
  abierto: boolean;
  horario: HorarioSemana | null;
  facturacionModo: FacturacionModo;
  // Keyed by CartItem.id (the line), not productId — two lines can share a
  // productId once modifiers are involved, so productId alone can't identify
  // which one to adjust.
  onChangeQty: (id: string, delta: number) => void;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<Step>("cart");

  // "entrega"
  const [metodoEntrega, setMetodoEntrega] = useState<MetodoEntrega>("RECOGER");
  const [horaRecogidaTipo, setHoraRecogidaTipo] = useState<HoraRecogidaTipo>("LO_ANTES_POSIBLE");
  const [horaRecogida, setHoraRecogida] = useState("");
  const [puntosEnvio, setPuntosEnvio] = useState<PublicPuntoEnvio[] | null>(null);
  const [puntoEnvioId, setPuntoEnvioId] = useState("");

  // "datos"
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  const [notas, setNotas] = useState("");

  // "pago"
  const [requiereFactura, setRequiereFactura] = useState(false);
  const [facturaRazonSocial, setFacturaRazonSocial] = useState("");
  const [facturaRfc, setFacturaRfc] = useState("");
  const [facturaRegimenFiscal, setFacturaRegimenFiscal] = useState("");
  const [facturaUsoCfdi, setFacturaUsoCfdi] = useState("");
  const [facturaCodigoPostal, setFacturaCodigoPostal] = useState("");
  const [facturaCorreo, setFacturaCorreo] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<PublicOrder | null>(null);

  useEffect(() => {
    fetchPublicPuntosEnvio(slug)
      .then(setPuntosEnvio)
      .catch(() => setPuntosEnvio([]));
  }, [slug]);

  const horarioHoy = horarioDeHoy(horario);
  const cotaInferior =
    horarioHoy?.abierto && horarioHoy.apertura && horarioHoy.cierre
      ? (() => {
          const minima = sumarMinutos(horaActualMexico(), MARGEN_MINIMO_MINUTOS);
          return minima > horarioHoy.apertura ? minima : horarioHoy.apertura;
        })()
      : null;
  const opcionesHora =
    cotaInferior && horarioHoy?.cierre ? generarOpcionesHora(cotaInferior, horarioHoy.cierre) : [];

  const zonaSeleccionada = puntosEnvio?.find((p) => p.id === puntoEnvioId) ?? null;
  const minimoZona = zonaSeleccionada?.pedidoMinimo != null ? Number(zonaSeleccionada.pedidoMinimo) : null;
  const faltantePorMinimo = minimoZona != null ? Math.max(0, minimoZona - total) : 0;
  const avisoMinimoVisible = Boolean(zonaSeleccionada) && faltantePorMinimo > 0;

  const canContinueEntrega =
    metodoEntrega === "RECOGER"
      ? horaRecogidaTipo === "LO_ANTES_POSIBLE" || horaRecogida !== ""
      : puntoEnvioId !== "" && faltantePorMinimo <= 0;

  const canContinueDatos = clienteNombre.trim().length >= 2 && clienteTelefono.trim().length >= 7;

  const facturaRequerida = facturacionModo === "OBLIGATORIO" || (facturacionModo === "OPCIONAL" && requiereFactura);
  const facturaCompleta =
    facturaRazonSocial.trim() !== "" &&
    facturaRfc.trim() !== "" &&
    facturaRegimenFiscal.trim() !== "" &&
    facturaUsoCfdi.trim() !== "" &&
    facturaCodigoPostal.trim() !== "" &&
    facturaCorreo.trim() !== "";

  const canSubmit = !submitting && (!facturaRequerida || facturaCompleta);

  // Display-only derived values for the redesigned summaries — none of this
  // feeds back into the createPublicOrder payload below.
  const totalUnidades = items.reduce((sum, item) => sum + item.cantidad, 0);
  const subtotalOriginal = resumenItems.reduce((sum, item) => sum + item.cantidad * item.precioOriginal, 0);
  // `total` (prop, computed in page.tsx) already includes modifiers' extra —
  // same formula the backend uses: subtotal + modifiersExtra - descuento.
  // Modifiers are never discounted, so they have to be added back before
  // subtracting `total` to isolate the discount alone; otherwise this would
  // misreport modifiers as if they were part of the discount.
  const modifiersExtraTotal = resumenItems.reduce(
    (sum, item) => sum + item.cantidad * item.modifiers.reduce((s, m) => s + m.precioAdicional, 0),
    0,
  );
  const descuentoProductos = Math.max(0, subtotalOriginal + modifiersExtraTotal - total);

  // The order response only stores puntoEnvioId (no name snapshot on Order —
  // see CLAUDE.md), so the confirmation step resolves the zone name from the
  // same list already fetched for the "entrega" step.
  const zonaOrden = order ? (puntosEnvio?.find((p) => p.id === order.puntoEnvioId) ?? null) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const created = await createPublicOrder(slug, {
        clienteNombre,
        clienteTelefono,
        notas: notas.trim() || undefined,
        horaRecogidaTipo: metodoEntrega === "RECOGER" ? horaRecogidaTipo : undefined,
        horaRecogida:
          metodoEntrega === "RECOGER" && horaRecogidaTipo === "HORA_ESPECIFICA" ? horaRecogida : undefined,
        metodoPago: "EFECTIVO",
        metodoEntrega,
        puntoEnvioId: metodoEntrega === "DOMICILIO" ? puntoEnvioId : undefined,
        requiereFactura: facturaRequerida || undefined,
        facturaRazonSocial: facturaRequerida ? facturaRazonSocial.trim() : undefined,
        facturaRfc: facturaRequerida ? facturaRfc.trim() : undefined,
        facturaRegimenFiscal: facturaRequerida ? facturaRegimenFiscal.trim() : undefined,
        facturaUsoCfdi: facturaRequerida ? facturaUsoCfdi.trim() : undefined,
        facturaCodigoPostal: facturaRequerida ? facturaCodigoPostal.trim() : undefined,
        facturaCorreo: facturaRequerida ? facturaCorreo.trim() : undefined,
        items: items.map((item) => ({
          productId: item.productId,
          cantidad: item.cantidad,
          modifierOptionIds: item.modifiers.length > 0 ? item.modifiers.map((m) => m.modifierOptionId) : undefined,
        })),
      });
      setOrder(created);
      setStep("confirmation");
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear tu pedido");
    } finally {
      setSubmitting(false);
    }
  }

  if (!abierto) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
        <div className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-white p-6 shadow-lg dark:bg-chat-card-dark">
          <h2 className="text-lg font-semibold">Estamos cerrados</h2>
          <p className="text-sm text-black/60 dark:text-white/60">
            No podemos recibir pedidos en este momento. Vuelve a intentarlo cuando abramos.
          </p>
          <button
            onClick={onClose}
            className="rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 dark:bg-white dark:text-black"
          >
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        className={`flex max-h-[85vh] w-full max-w-sm flex-col gap-4 overflow-y-auto rounded-xl bg-white p-6 shadow-lg dark:bg-chat-card-dark ${
          step === "entrega" ? "pb-24" : ""
        }`}
      >
        {/* El paso "entrega" agrega pb-24 aquí (encima del p-6 normal) porque
            su botón "Continuar" es sticky bottom-0: cuando el contenido no
            cabe en max-h-[85vh], el sticky se clampa dentro del área visible
            del scroll respetando este padding-bottom como "zona segura"
            debajo de él. Sin este padding extra, el sticky se recalcula más
            arriba de lo esperado y tapa el último texto/aviso del paso. */}
        {step === "cart" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Tu pedido</h2>
              <button
                onClick={onClose}
                className="text-sm text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white"
              >
                Cerrar
              </button>
            </div>

            <ul className="flex flex-col gap-2">
              {items.map((item) => {
                const extraPorUnidad = item.modifiers.reduce((sum, m) => sum + m.precioAdicional, 0);
                return (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-black/[0.03] p-3 dark:bg-white/5"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{item.nombre}</span>
                    {item.modifiers.length > 0 && (
                      <span className="text-xs text-black/50 dark:text-white/50">
                        {item.modifiers.map((m) => `+ ${m.nombre}`).join(", ")}
                      </span>
                    )}
                    <span className="text-xs text-black/50 dark:text-white/50">
                      ${(item.precioUnitario + extraPorUnidad).toFixed(2)} c/u
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded-full bg-black px-1.5 py-1 text-white dark:bg-white dark:text-black">
                    <button
                      onClick={() => onChangeQty(item.id, -1)}
                      aria-label="Quitar uno"
                      className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium"
                    >
                      −
                    </button>
                    <span className="w-4 text-center text-sm font-semibold">{item.cantidad}</span>
                    <button
                      onClick={() => onChangeQty(item.id, 1)}
                      aria-label="Agregar uno"
                      className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium"
                    >
                      +
                    </button>
                  </div>
                </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-between border-t border-black/10 pt-3 text-sm font-semibold dark:border-white/10">
              <span>Total estimado</span>
              <span>${total.toFixed(2)}</span>
            </div>
            <p className="text-xs text-black/50 dark:text-white/50">
              El precio de combos y descuentos se confirma al enviar tu pedido.
            </p>

            <button
              onClick={() => setStep("entrega")}
              disabled={items.length === 0}
              className="rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
            >
              Continuar ({totalUnidades} artículo{totalUnidades === 1 ? "" : "s"})
            </button>
          </>
        )}

        {step === "entrega" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Entrega</h2>
              <button onClick={() => setStep("cart")} className={BACK_LINK}>
                Atrás
              </button>
            </div>

            <div className="flex flex-col gap-1.5 text-sm font-medium">
              Método de entrega
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMetodoEntrega("RECOGER")}
                  className={metodoEntrega === "RECOGER" ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}
                >
                  Recoger
                </button>
                <button
                  type="button"
                  disabled={!puntosEnvio || puntosEnvio.length === 0}
                  onClick={() => setMetodoEntrega("DOMICILIO")}
                  className={metodoEntrega === "DOMICILIO" ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}
                >
                  A domicilio
                </button>
              </div>
              {puntosEnvio && puntosEnvio.length === 0 && (
                <span className="text-xs font-normal text-black/50 dark:text-white/50">
                  Este negocio no ofrece entrega a domicilio por ahora.
                </span>
              )}
            </div>

            {metodoEntrega === "RECOGER" ? (
              <div className="flex flex-col gap-1.5 text-sm font-medium">
                Hora de recogida
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setHoraRecogidaTipo("LO_ANTES_POSIBLE")}
                    className={horaRecogidaTipo === "LO_ANTES_POSIBLE" ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}
                  >
                    Lo antes posible
                  </button>
                  <button
                    type="button"
                    disabled={opcionesHora.length === 0}
                    onClick={() => setHoraRecogidaTipo("HORA_ESPECIFICA")}
                    className={horaRecogidaTipo === "HORA_ESPECIFICA" ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}
                  >
                    Elegir hora
                  </button>
                </div>
                {opcionesHora.length === 0 && (
                  <span className="text-xs font-normal text-black/50 dark:text-white/50">
                    Ya no queda margen para elegir una hora hoy — solo puedes pedir lo antes posible.
                  </span>
                )}
                {horaRecogidaTipo === "HORA_ESPECIFICA" && opcionesHora.length > 0 && (
                  <select
                    required
                    value={horaRecogida}
                    onChange={(e) => setHoraRecogida(e.target.value)}
                    className="input"
                  >
                    <option value="">Selecciona...</option>
                    {opcionesHora.map((hora) => (
                      <option key={hora} value={hora}>
                        {hora}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 text-sm font-medium">
                Zona de entrega
                <select
                  required
                  value={puntoEnvioId}
                  onChange={(e) => setPuntoEnvioId(e.target.value)}
                  className="input"
                >
                  <option value="">Selecciona una zona...</option>
                  {(puntosEnvio ?? []).map((punto) => (
                    <option key={punto.id} value={punto.id}>
                      {punto.nombre}
                      {punto.pedidoMinimo ? ` (mínimo $${Number(punto.pedidoMinimo).toFixed(2)})` : ""}
                    </option>
                  ))}
                </select>
                {zonaSeleccionada && (
                  <span className="text-xs font-normal text-black/50 dark:text-white/50">
                    {zonaSeleccionada.direccion}
                  </span>
                )}
                <div
                  className={`overflow-hidden rounded-xl border text-xs font-normal transition-all duration-300 ease-in-out ${
                    avisoMinimoVisible
                      ? "mt-0 max-h-24 border-amber-200 bg-amber-50 p-3 text-amber-800 opacity-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                      : "max-h-0 border-transparent p-0 text-amber-800 opacity-0 dark:text-amber-300"
                  }`}
                >
                  Te faltan ${faltantePorMinimo.toFixed(2)} para el pedido mínimo de esta zona (${(minimoZona ?? 0).toFixed(2)}).
                </div>
              </div>
            )}

            <div className="sticky bottom-0 bg-white pb-1 pt-3 dark:bg-chat-card-dark">
              <button
                type="button"
                onClick={() => setStep("datos")}
                disabled={!canContinueEntrega}
                className={BTN_PRIMARY}
              >
                Continuar
              </button>
            </div>
          </>
        )}

        {step === "datos" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Tus datos</h2>
              <button onClick={() => setStep("entrega")} className={BACK_LINK}>
                Atrás
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Nombre
                <input
                  required
                  minLength={2}
                  value={clienteNombre}
                  onChange={(e) => setClienteNombre(e.target.value)}
                  placeholder="Tu nombre"
                  className="input"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Teléfono
                <input
                  required
                  minLength={7}
                  value={clienteTelefono}
                  onChange={(e) => setClienteTelefono(e.target.value)}
                  placeholder="55 1234 5678"
                  className="input"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Notas (opcional)
                <input
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder="Sin cebolla, tocar el timbre, etc."
                  className="input"
                />
              </label>
            </div>

            <button type="button" onClick={() => setStep("pago")} disabled={!canContinueDatos} className={BTN_PRIMARY}>
              Continuar
            </button>
          </>
        )}

        {step === "pago" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Pago</h2>
              <button onClick={() => setStep("datos")} className={BACK_LINK}>
                Atrás
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className={RESUMEN_BOX}>
                <span className={RESUMEN_LABEL}>Resumen</span>
                <ul className="flex flex-col gap-1">
                  {resumenItems.map((item) => {
                    const extraPorUnidad = item.modifiers.reduce((sum, m) => sum + m.precioAdicional, 0);
                    return (
                      <li key={item.id} className="flex flex-col gap-0.5 text-sm">
                        <div className="flex items-center justify-between">
                          <span>
                            {item.cantidad}× {item.nombre}
                          </span>
                          <span>${(item.cantidad * (item.precioUnitario + extraPorUnidad)).toFixed(2)}</span>
                        </div>
                        {item.modifiers.length > 0 && (
                          <span className="text-xs text-black/50 dark:text-white/50">
                            {item.modifiers.map((m) => `+ ${m.nombre}`).join(", ")}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="flex flex-col gap-1 border-t border-black/10 pt-2 text-sm dark:border-white/10">
                  <div className="flex items-center justify-between text-black/60 dark:text-white/60">
                    <span>Subtotal</span>
                    <span>${subtotalOriginal.toFixed(2)}</span>
                  </div>
                  {descuentoProductos > 0 && (
                    <div className="flex items-center justify-between text-red-600 dark:text-red-400">
                      <span>Descuento</span>
                      <span>-${descuentoProductos.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between font-semibold">
                    <span>Total</span>
                    <span>${total.toFixed(2)}</span>
                  </div>
                </div>
                <p className="text-xs text-black/50 dark:text-white/50">
                  El precio de combos se ajusta al finalizar tu pedido.
                </p>
              </div>

              <div className="flex flex-col gap-1.5 text-sm font-medium">
                Método de pago
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-2 rounded-lg border-2 border-black bg-black/5 px-3 py-2 text-xs font-semibold text-black dark:border-white dark:bg-white/10 dark:text-white">
                    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-black dark:border-white">
                      <span className="h-1.5 w-1.5 rounded-full bg-black dark:bg-white" />
                    </span>
                    Efectivo
                  </span>
                  <span
                    aria-disabled="true"
                    className="flex cursor-not-allowed items-center gap-2 rounded-lg border-2 border-black/10 px-3 py-2 text-xs font-medium text-black/30 dark:border-white/10 dark:text-white/30"
                  >
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-black/15 dark:border-white/15" />
                    Transferencia — próximamente
                  </span>
                  <span
                    aria-disabled="true"
                    className="flex cursor-not-allowed items-center gap-2 rounded-lg border-2 border-black/10 px-3 py-2 text-xs font-medium text-black/30 dark:border-white/10 dark:text-white/30"
                  >
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-black/15 dark:border-white/15" />
                    Tarjeta — próximamente
                  </span>
                </div>
              </div>

              {facturacionModo !== "DESACTIVADO" && (
                <div className={RESUMEN_BOX}>
                  {facturacionModo === "OPCIONAL" ? (
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={requiereFactura}
                        onChange={(e) => setRequiereFactura(e.target.checked)}
                      />
                      Quiero factura
                    </label>
                  ) : (
                    <span className="text-sm font-medium">Datos de facturación</span>
                  )}

                  {facturaRequerida && (
                    <div className="flex flex-col gap-2">
                      <label className="flex flex-col gap-1.5 text-sm font-medium">
                        Nombre / razón social
                        <input
                          required
                          value={facturaRazonSocial}
                          onChange={(e) => setFacturaRazonSocial(e.target.value)}
                          className="input"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm font-medium">
                        RFC
                        <input required value={facturaRfc} onChange={(e) => setFacturaRfc(e.target.value)} className="input" />
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm font-medium">
                        Régimen fiscal
                        <select
                          required
                          value={facturaRegimenFiscal}
                          onChange={(e) => setFacturaRegimenFiscal(e.target.value)}
                          className="input"
                        >
                          <option value="" disabled>
                            Selecciona tu régimen...
                          </option>
                          {REGIMEN_FISCAL.map((item) => (
                            <option key={item.clave} value={item.clave}>
                              {item.clave} - {item.descripcion}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm font-medium">
                        Uso de CFDI
                        <select
                          required
                          value={facturaUsoCfdi}
                          onChange={(e) => setFacturaUsoCfdi(e.target.value)}
                          className="input"
                        >
                          <option value="" disabled>
                            Selecciona el uso...
                          </option>
                          {USO_CFDI.map((item) => (
                            <option key={item.clave} value={item.clave}>
                              {item.clave} - {item.descripcion}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm font-medium">
                        Código postal fiscal
                        <input
                          required
                          value={facturaCodigoPostal}
                          onChange={(e) => setFacturaCodigoPostal(e.target.value)}
                          className="input"
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-sm font-medium">
                        Correo electrónico
                        <input
                          required
                          type="email"
                          value={facturaCorreo}
                          onChange={(e) => setFacturaCorreo(e.target.value)}
                          className="input"
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
              >
                {submitting ? "Enviando..." : "Confirmar pedido"}
              </button>
            </form>
          </>
        )}

        {step === "confirmation" && order && (
          <>
            <h2 className="text-lg font-semibold">¡Pedido recibido!</h2>
            <p className="text-sm text-black/60 dark:text-white/60">
              Tu folio es <span className="font-semibold text-black dark:text-white">#{order.folio}</span>.{" "}
              {order.metodoEntrega === "DOMICILIO"
                ? "Te avisaremos cuando salga a reparto."
                : order.horaRecogidaTipo === "HORA_ESPECIFICA" && order.horaRecogida
                  ? `Te esperamos a las ${order.horaRecogida}.`
                  : "Te avisaremos cuando esté listo."}
            </p>

            <div className={RESUMEN_BOX}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-black/60 dark:text-white/60">Entrega</span>
                <span className="font-medium">
                  {order.metodoEntrega === "DOMICILIO" ? "A domicilio" : "Recoger en tienda"}
                </span>
              </div>
              {order.metodoEntrega === "DOMICILIO" && zonaOrden && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-black/60 dark:text-white/60">Zona</span>
                  <span className="font-medium">{zonaOrden.nombre}</span>
                </div>
              )}
            </div>

            <ul className="flex flex-col gap-2">
              {order.items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded-xl bg-black/[0.03] p-3 text-sm dark:bg-white/5"
                >
                  <span>
                    {item.cantidad}× {item.nombreProducto}
                  </span>
                  <span>${(Number(item.precioUnitario) * item.cantidad).toFixed(2)}</span>
                </li>
              ))}
            </ul>

            {Number(order.descuentoTotal) > 0 && (
              <div className="flex items-center justify-between text-sm text-red-600 dark:text-red-400">
                <span>{order.notasDescuento ?? "Descuento aplicado"}</span>
                <span>-${Number(order.descuentoTotal).toFixed(2)}</span>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-black/10 pt-3 text-sm font-semibold dark:border-white/10">
              <span>Total</span>
              <span>${Number(order.total).toFixed(2)}</span>
            </div>

            {order.requiereFactura && (
              <div className={RESUMEN_BOX}>
                <span className={RESUMEN_LABEL}>Factura</span>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-black/60 dark:text-white/60">Razón social</span>
                  <span className="font-medium">{order.facturaRazonSocial}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-black/60 dark:text-white/60">RFC</span>
                  <span className="font-medium">{order.facturaRfc}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-black/60 dark:text-white/60">Correo</span>
                  <span className="font-medium">{order.facturaCorreo}</span>
                </div>
              </div>
            )}

            <button
              onClick={onClose}
              className="rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 dark:bg-white dark:text-black"
            >
              Cerrar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
