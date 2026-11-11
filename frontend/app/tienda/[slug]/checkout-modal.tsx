"use client";

import { useEffect, useRef, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import {
  ApiError,
  createPublicOrder,
  fetchPublicEstadoPago,
  fetchPublicPuntosEnvio,
  type FacturacionModo,
  type HorarioSemana,
  type MetodoEntrega,
  type MetodoPago,
  type PublicOrder,
  type PublicPuntoEnvio,
} from "@/lib/api";
import { getStripe } from "@/lib/stripe";
import {
  diasDisponibles,
  duracionesDisponibles,
  etiquetaDia,
  fechaActualMexico,
  formatoDuracion,
  horaActualMexico,
  horasDisponiblesParaFecha,
  partesDia,
  sumarMinutos,
} from "@/lib/horario";
import RuedaHoraMin, { aMinutos, deMinutos } from "./rueda-hora";
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
  // Nota por producto ya normalizada ("" o ausente = sin nota). Forma parte de la identidad de la línea.
  nota?: string;
}

// Same shape as CartItem, plus the pre-discount list price — used to render
// the payment summary in the "pago" step (subtotal/descuento breakdown).
// Computed by page.tsx (it already has catalog + precioConDescuento in
// scope); this component only displays it, never recomputes pricing.
export interface ResumenItem extends CartItem {
  precioOriginal: number;
}

// Orden del flujo: confirmar pedido (cart) → tus datos → entrega (pickup / envío a domicilio) → método de pago.
type Step = "cart" | "datos" | "entrega" | "pago" | "pago-tarjeta" | "confirmation";

const MARGEN_MINIMO_MINUTOS = 15;

const TOGGLE_ACTIVE =
  "rounded-lg border-2 border-black bg-black/5 px-3 py-1.5 text-xs font-semibold text-black dark:border-white dark:bg-white/10 dark:text-white";
const TOGGLE_INACTIVE =
  "rounded-lg border-2 border-black/15 px-3 py-1.5 text-xs font-medium text-black/60 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:text-white/60 dark:hover:bg-white/10";
const BTN_PRIMARY =
  "rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black";
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
  aceptaTarjeta,
  anticipacionPickupMinutos = 0,
  anticipacionDomicilioMinutos = 0,
  diasMaxAgendar = 0,
  onChangeQty,
  onClose: onCerrarProp,
  onSuccess,
}: {
  slug: string;
  items: CartItem[];
  total: number;
  resumenItems: ResumenItem[];
  abierto: boolean;
  horario: HorarioSemana | null;
  facturacionModo: FacturacionModo;
  aceptaTarjeta: boolean;
  // Reglas de entrega del negocio (horas mínimas por método y días hacia adelante que se puede agendar). El servidor
  // las vuelve a validar; aquí solo definen qué días/horas se ofrecen.
  anticipacionPickupMinutos?: number;
  anticipacionDomicilioMinutos?: number;
  diasMaxAgendar?: number;
  // Keyed by CartItem.id (the line), not productId — two lines can share a
  // productId once modifiers are involved, so productId alone can't identify
  // which one to adjust.
  onChangeQty: (id: string, delta: number) => void;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<Step>("cart");

  // Historial del navegador por paso: cada paso empuja una entrada, así el botón «atrás» (y el gesto en el celular)
  // vuelve al paso anterior en vez de salir de la tienda. `pila` refleja las entradas que este checkout empujó.
  const pila = useRef<Step[]>(["cart"]);
  const empujado = useRef(false);
  const cerrando = useRef(false);

  function irA(siguiente: Step) {
    if (siguiente === "confirmation") {
      // El pedido ya se creó: no se puede «volver» a pagar; la confirmación ocupa el lugar del paso anterior.
      window.history.replaceState(window.history.state, "");
      pila.current[pila.current.length - 1] = siguiente;
    } else {
      window.history.pushState(window.history.state, "");
      pila.current.push(siguiente);
    }
    setStep(siguiente);
  }

  function atras() {
    window.history.back();
  }

  // Cierra el checkout y deshace las entradas de historial que empujó.
  function cerrar() {
    const n = pila.current.length;
    pila.current = [];
    cerrando.current = true;
    if (n > 0) window.history.go(-n);
    onCerrarProp();
  }

  useEffect(() => {
    if (!empujado.current) {
      empujado.current = true;
      window.history.pushState(window.history.state, "");
    }
    function alPopState() {
      if (cerrando.current) return;
      const salida = pila.current.pop();
      const nuevo = pila.current[pila.current.length - 1];
      if (!nuevo || salida === "confirmation") cerrar();
      else setStep(nuevo);
    }
    window.addEventListener("popstate", alPopState);
    return () => window.removeEventListener("popstate", alPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "entrega"
  const [metodoEntrega, setMetodoEntrega] = useState<MetodoEntrega>("RECOGER");
  // Hora elegida en la rueda de reloj ("HH:mm", cuando hay varios días) y duración elegida en la rueda de "recoger
  // en X" (minutos, cuando solo hay hoy). Ninguna es obligatoria: si no hay elección válida se usa la primera
  // opción disponible (valores derivados abajo), así Continuar nunca queda trabado por no haber tocado la rueda.
  const [horaRecogida, setHoraRecogida] = useState("");
  const [duracionElegida, setDuracionElegida] = useState<number | null>(null);
  // Día elegido ("YYYY-MM-DD"); "" = el primero disponible.
  const [fechaElegida, setFechaElegida] = useState("");
  const [puntosEnvio, setPuntosEnvio] = useState<PublicPuntoEnvio[] | null>(null);
  const [puntoEnvioId, setPuntoEnvioId] = useState("");
  const [direccionCalle, setDireccionCalle] = useState("");
  const [direccionNumero, setDireccionNumero] = useState("");
  const [direccionColonia, setDireccionColonia] = useState("");
  const [direccionReferencias, setDireccionReferencias] = useState("");

  // "datos"
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteTelefono, setClienteTelefono] = useState("");
  // Opcional — a diferencia de facturaCorreo (paso "pago", solo si el
  // tenant tiene facturación activa), este es el correo general, capturado
  // siempre en este paso, independiente de facturación. No participa en
  // canContinueDatos: dejarlo vacío no bloquea el checkout.
  const [clienteCorreo, setClienteCorreo] = useState("");
  const [notas, setNotas] = useState("");

  // "pago"
  const [metodoPago, setMetodoPago] = useState<MetodoPago>("EFECTIVO");
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

  // Reglas de entrega: cada método tiene su anticipación mínima y el negocio define cuántos días se pueden elegir.
  // La vista cambia según haya un solo día (hoy) o varios:
  //  - pickup solo hoy: rueda "recoger en [h] [min]", pasos de 15 min (la hora real se calcula al enviar);
  //  - domicilio, o varios días (o un único día que no es hoy): chips de día (si hay más de uno) + rueda de reloj
  //    "entregar a las HH:mm" cada 30 min. El domicilio siempre es una hora de reloj, nunca un temporizador.
  const anticipacionMinutos = metodoEntrega === "DOMICILIO" ? anticipacionDomicilioMinutos : anticipacionPickupMinutos;
  const minutosMinimos = Math.max(MARGEN_MINIMO_MINUTOS, anticipacionMinutos);
  const hoy = fechaActualMexico();
  const dias = diasDisponibles(horario, diasMaxAgendar, minutosMinimos);
  const fechaSel = dias.find((d) => d.fecha === fechaElegida)?.fecha ?? dias[0]?.fecha ?? hoy;
  const modoDuracion = metodoEntrega === "RECOGER" && dias.length <= 1 && fechaSel === hoy;
  const duraciones = modoDuracion ? duracionesDisponibles(horario, minutosMinimos) : [];
  const horasDelDia = modoDuracion ? [] : horasDisponiblesParaFecha(horario, fechaSel, minutosMinimos);
  const duracionSel =
    duracionElegida != null && duraciones.includes(duracionElegida) ? duracionElegida : (duraciones[0] ?? null);
  const horaSel = horasDelDia.includes(horaRecogida) ? horaRecogida : (horasDelDia[0] ?? "");
  const horaPorDuracion = duracionSel != null ? sumarMinutos(horaActualMexico(), duracionSel) : "";
  const horaEntrega = modoDuracion ? horaPorDuracion : horaSel;
  const sinOpcionesDeHora = modoDuracion ? duraciones.length === 0 : horasDelDia.length === 0;

  function reiniciarHora() {
    setHoraRecogida("");
    setDuracionElegida(null);
  }

  function elegirMetodoEntrega(metodo: MetodoEntrega) {
    if (metodo === metodoEntrega) return;
    setMetodoEntrega(metodo);
    setFechaElegida("");
    reiniciarHora();
  }

  function elegirFecha(fecha: string) {
    setFechaElegida(fecha);
    reiniciarHora();
  }

  // Con una sola zona no hay nada que elegir: se selecciona sola y el <select> ni aparece.
  const unaSolaZona = puntosEnvio?.length === 1;
  const puntoEnvioIdEfectivo = unaSolaZona ? puntosEnvio![0].id : puntoEnvioId;

  // El envío a domicilio solo se habilita si el pedido alcanza el mínimo de al menos una zona (la más baja);
  // dentro de la lista, las zonas con un mínimo mayor al total quedan deshabilitadas.
  const minimoDomicilio =
    puntosEnvio && puntosEnvio.length > 0 ? Math.min(...puntosEnvio.map((p) => Number(p.pedidoMinimo ?? 0))) : null;
  const faltanteDomicilio = minimoDomicilio != null ? Math.max(0, minimoDomicilio - total) : 0;
  const domicilioNoDisponible = !puntosEnvio || puntosEnvio.length === 0 || faltanteDomicilio > 0;
  // Si el carrito baja del mínimo después de haber elegido domicilio (solo se puede editar en el paso del carrito),
  // se regresa a pickup y se reinicia la hora (la anticipación es por método).
  function cambiarCantidad(id: string, delta: number) {
    onChangeQty(id, delta);
    if (metodoEntrega === "DOMICILIO") {
      setMetodoEntrega("RECOGER");
      setFechaElegida("");
      reiniciarHora();
    }
  }

  const zonaSeleccionada = puntosEnvio?.find((p) => p.id === puntoEnvioIdEfectivo) ?? null;
  const minimoZona = zonaSeleccionada?.pedidoMinimo != null ? Number(zonaSeleccionada.pedidoMinimo) : null;
  const faltantePorMinimo = minimoZona != null ? Math.max(0, minimoZona - total) : 0;

  const canContinueEntrega =
    horaEntrega !== "" &&
    (metodoEntrega === "RECOGER" ||
      (puntoEnvioIdEfectivo !== "" &&
        faltantePorMinimo <= 0 &&
        direccionCalle.trim() !== "" &&
        direccionNumero.trim() !== "" &&
        direccionColonia.trim() !== ""));

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
      // Con la rueda de "recoger en X", la hora real se calcula aquí, lo más cerca posible del request, con la hora
      // actual de este instante (el cliente tarda en pasar por "Datos"/"Pago" y la hora mostrada se habría quedado
      // atrás). Con la rueda de reloj se manda tal cual la hora de reloj elegida.
      const horaRecogidaFinal =
        modoDuracion && duracionSel != null ? sumarMinutos(horaActualMexico(), duracionSel) : horaSel;

      const created = await createPublicOrder(slug, {
        clienteNombre,
        clienteTelefono,
        clienteCorreo: clienteCorreo.trim() || undefined,
        notas: notas.trim() || undefined,
        // horaRecogidaTipo siempre es HORA_ESPECIFICA: LO_ANTES_POSIBLE ya no se ofrece (la rueda de "recoger en X"
        // cubre ese caso con una hora concreta). Pickup y domicilio comparten día/hora (el servidor aplica la
        // anticipación de cada método).
        horaRecogidaTipo: "HORA_ESPECIFICA",
        horaRecogida: horaRecogidaFinal,
        fechaEntrega: fechaSel,
        metodoPago,
        metodoEntrega,
        puntoEnvioId: metodoEntrega === "DOMICILIO" ? puntoEnvioIdEfectivo : undefined,
        direccionCalle: metodoEntrega === "DOMICILIO" ? direccionCalle.trim() : undefined,
        direccionNumero: metodoEntrega === "DOMICILIO" ? direccionNumero.trim() : undefined,
        direccionColonia: metodoEntrega === "DOMICILIO" ? direccionColonia.trim() : undefined,
        direccionReferencias:
          metodoEntrega === "DOMICILIO" ? direccionReferencias.trim() || undefined : undefined,
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
          nota: item.nota || undefined,
        })),
      });
      setOrder(created);
      // TARJETA: the order exists (folio assigned, PENDIENTE) but nothing has
      // been charged yet — created.clientSecret is what lets the "pago-tarjeta"
      // step actually collect and confirm the card. onSuccess() (clears the
      // cart) only fires once payment is confirmed there, not here.
      if (metodoPago === "TARJETA" && created.clientSecret) {
        irA("pago-tarjeta");
      } else {
        irA("confirmation");
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear tu pedido");
    } finally {
      setSubmitting(false);
    }
  }

  if (!abierto) {
    return (
      <HojaInferior>
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Estamos cerrados</h2>
          <p className="text-sm text-black/60 dark:text-white/60">
            No podemos recibir pedidos en este momento. Vuelve a intentarlo cuando abramos.
          </p>
          <button
            onClick={cerrar}
            className="rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 dark:bg-white dark:text-black"
          >
            Cerrar
          </button>
        </div>
      </HojaInferior>
    );
  }

  return (
    // Hoja anclada abajo cuya altura se adapta al contenido de cada paso (con transición suave); en pasos largos
    // scrollea por dentro con el encabezado y el botón principal fijos. Ver HojaInferior.
    <HojaInferior>
        {step === "cart" && (
          <>
            <EncabezadoPantalla titulo="Confirma tu pedido" onAtras={cerrar} etiqueta="Cerrar" cerrar />

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
                    {item.nota && (
                      <span className="text-xs italic text-black/50 dark:text-white/50">↳ {item.nota}</span>
                    )}
                    <span className="text-xs text-black/50 dark:text-white/50">
                      ${(item.precioUnitario + extraPorUnidad).toFixed(2)} c/u
                    </span>
                  </div>
                  <div className="flex items-center gap-2 rounded-full bg-black px-1.5 py-1 text-white dark:bg-white dark:text-black">
                    <button
                      onClick={() => cambiarCantidad(item.id, -1)}
                      aria-label="Quitar uno"
                      className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium"
                    >
                      −
                    </button>
                    <span className="w-4 text-center text-sm font-semibold">{item.cantidad}</span>
                    <button
                      onClick={() => cambiarCantidad(item.id, 1)}
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

            <PieFijo>
              <button onClick={() => irA("datos")} disabled={items.length === 0} className={BTN_PRIMARY}>
                Continuar ({totalUnidades} artículo{totalUnidades === 1 ? "" : "s"})
              </button>
            </PieFijo>
          </>
        )}

        {step === "entrega" && (
          <>
            <EncabezadoPantalla titulo="Entrega" onAtras={atras} />

            <div className="flex flex-col gap-1.5 text-sm font-medium">
              Método de entrega
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => elegirMetodoEntrega("RECOGER")}
                  className={metodoEntrega === "RECOGER" ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}
                >
                  Pickup
                </button>
                <button
                  type="button"
                  disabled={domicilioNoDisponible}
                  onClick={() => elegirMetodoEntrega("DOMICILIO")}
                  className={metodoEntrega === "DOMICILIO" ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}
                >
                  Envío a domicilio
                </button>
              </div>
              {puntosEnvio && puntosEnvio.length === 0 && (
                <span className="text-xs font-normal text-black/50 dark:text-white/50">
                  Este negocio no ofrece entrega a domicilio por ahora.
                </span>
              )}
              {puntosEnvio && puntosEnvio.length > 0 && faltanteDomicilio > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-normal text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  El envío a domicilio es desde ${(minimoDomicilio ?? 0).toFixed(2)} de pedido: te faltan $
                  {faltanteDomicilio.toFixed(2)}. Agrega más productos para habilitarlo.
                </div>
              )}
            </div>

            {metodoEntrega === "DOMICILIO" && (
              <div className="flex flex-col gap-1.5 text-sm font-medium">
                {!unaSolaZona && (
                  <>
                    Zona de entrega
                    <select
                      required
                      value={puntoEnvioId}
                      onChange={(e) => setPuntoEnvioId(e.target.value)}
                      className="input"
                    >
                      <option value="">Selecciona una zona...</option>
                      {(puntosEnvio ?? []).map((punto) => {
                        const minimo = punto.pedidoMinimo != null ? Number(punto.pedidoMinimo) : 0;
                        return (
                          <option key={punto.id} value={punto.id} disabled={minimo > total}>
                            {punto.nombre}
                            {minimo > 0 ? ` (mínimo $${minimo.toFixed(2)})` : ""}
                          </option>
                        );
                      })}
                    </select>
                    {zonaSeleccionada && (
                      <span className="text-xs font-normal text-black/50 dark:text-white/50">
                        {zonaSeleccionada.direccion}
                      </span>
                    )}
                  </>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Calle
                    <input
                      required
                      value={direccionCalle}
                      onChange={(e) => setDireccionCalle(e.target.value)}
                      className="input"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Número
                    <input
                      required
                      value={direccionNumero}
                      onChange={(e) => setDireccionNumero(e.target.value)}
                      className="input"
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Colonia
                  <input
                    required
                    value={direccionColonia}
                    onChange={(e) => setDireccionColonia(e.target.value)}
                    className="input"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Referencias (opcional)
                  <input
                    value={direccionReferencias}
                    onChange={(e) => setDireccionReferencias(e.target.value)}
                    placeholder="Portón negro, entre calles, etc."
                    className="input"
                  />
                </label>
              </div>
            )}

              <div className="flex flex-col gap-1.5 text-sm font-medium">
                {dias.length > 1 && (
                  <>
                    Día
                    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label="Día">
                      {dias.map((dia) => {
                        const { titulo, detalle } = partesDia(dia.fecha, hoy);
                        const activo = dia.fecha === fechaSel;
                        return (
                          <button
                            key={dia.fecha}
                            type="button"
                            role="radio"
                            aria-checked={activo}
                            onClick={() => elegirFecha(dia.fecha)}
                            className={`flex min-w-16 shrink-0 flex-col items-center rounded-xl border-2 px-3 py-2 leading-tight ${
                              activo
                                ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                                : "border-black/15 text-black/70 hover:bg-black/5 dark:border-white/20 dark:text-white/70 dark:hover:bg-white/10"
                            }`}
                          >
                            <span className="text-xs font-semibold">{titulo}</span>
                            <span className={`text-[11px] font-normal ${activo ? "opacity-80" : "opacity-60"}`}>{detalle}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                {modoDuracion ? "Pasar a recoger en" : metodoEntrega === "DOMICILIO" ? "Entregar a las:" : "Hora de recogida"}
                {anticipacionMinutos > 0 && (
                  <span className="text-xs font-normal text-black/50 dark:text-white/50">
                    Este negocio pide {formatoDuracion(anticipacionMinutos)} de anticipación
                    {dias[0] && dias[0].fecha !== hoy ? ` — el primer día disponible es ${dias[0].etiqueta.toLowerCase()}.` : "."}
                  </span>
                )}
                {dias.length === 1 && fechaSel !== hoy && (
                  <span className="text-xs font-normal text-black/50 dark:text-white/50">Día: {dias[0].etiqueta}</span>
                )}
                {modoDuracion && duraciones.length > 0 && duracionSel != null && (
                  <>
                    <RuedaHoraMin modo="duracion" opciones={duraciones} valor={duracionSel} onChange={setDuracionElegida} />
                    <span className="text-center text-xs font-normal text-black/50 dark:text-white/50">
                      Estará listo aprox. a las {horaPorDuracion}
                    </span>
                  </>
                )}
                {!modoDuracion && horasDelDia.length > 0 && (
                  <RuedaHoraMin
                    modo="reloj"
                    opciones={horasDelDia.map(aMinutos)}
                    valor={aMinutos(horaSel)}
                    onChange={(total) => setHoraRecogida(deMinutos(total))}
                  />
                )}
                {sinOpcionesDeHora && (
                  <span className="text-xs font-normal text-black/50 dark:text-white/50">
                    {anticipacionMinutos > 0
                      ? "Por ahora no hay horarios disponibles con la anticipación que pide este negocio."
                      : "Ya no queda margen para elegir una hora hoy."}
                  </span>
                )}
              </div>

            <PieFijo>
              <button
                type="button"
                onClick={() => irA("pago")}
                disabled={!canContinueEntrega}
                className={BTN_PRIMARY}
              >
                Continuar
              </button>
            </PieFijo>
          </>
        )}

        {step === "datos" && (
          <>
            <EncabezadoPantalla titulo="Tus datos" onAtras={atras} />

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
                Correo (opcional)
                <input
                  type="email"
                  value={clienteCorreo}
                  onChange={(e) => setClienteCorreo(e.target.value)}
                  placeholder="tucorreo@ejemplo.com"
                  className="input"
                />
                <span className="text-xs font-normal text-black/50 dark:text-white/50">
                  Para avisarte cuando tu pedido cambie de estatus.
                </span>
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

            <PieFijo>
              <button type="button" onClick={() => irA("entrega")} disabled={!canContinueDatos} className={BTN_PRIMARY}>
                Continuar
              </button>
            </PieFijo>
          </>
        )}

        {step === "pago" && (
          <>
            <EncabezadoPantalla titulo="Selecciona tu método de pago" onAtras={atras} />

            <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-3">
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
                        {item.nota && (
                          <span className="text-xs italic text-black/50 dark:text-white/50">↳ {item.nota}</span>
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

              {metodoEntrega === "DOMICILIO" && zonaSeleccionada && (
                <div className={RESUMEN_BOX}>
                  <span className={RESUMEN_LABEL}>Entrega</span>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-black/60 dark:text-white/60">Zona</span>
                    <span className="font-medium">{zonaSeleccionada.nombre}</span>
                  </div>
                  <div className="flex flex-col gap-0.5 text-sm">
                    <span className="text-black/60 dark:text-white/60">Dirección</span>
                    <span className="font-medium">
                      {direccionCalle} {direccionNumero}, {direccionColonia}
                    </span>
                    {direccionReferencias.trim() !== "" && (
                      <span className="text-xs text-black/50 dark:text-white/50">{direccionReferencias}</span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5 text-sm font-medium">
                Método de pago
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => setMetodoPago("EFECTIVO")}
                    className={
                      metodoPago === "EFECTIVO"
                        ? "flex items-center gap-2 rounded-lg border-2 border-black bg-black/5 px-3 py-2 text-xs font-semibold text-black dark:border-white dark:bg-white/10 dark:text-white"
                        : "flex items-center gap-2 rounded-lg border-2 border-black/15 px-3 py-2 text-xs font-medium text-black/60 dark:border-white/20 dark:text-white/60"
                    }
                  >
                    <span
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 ${
                        metodoPago === "EFECTIVO" ? "border-black dark:border-white" : "border-black/30 dark:border-white/30"
                      }`}
                    >
                      {metodoPago === "EFECTIVO" && <span className="h-1.5 w-1.5 rounded-full bg-black dark:bg-white" />}
                    </span>
                    {metodoEntrega === "RECOGER" ? "Pagar al recoger" : "Pagar al recibir"}
                  </button>

                  {aceptaTarjeta ? (
                    <button
                      type="button"
                      onClick={() => setMetodoPago("TARJETA")}
                      className={
                        metodoPago === "TARJETA"
                          ? "flex items-center gap-2 rounded-lg border-2 border-black bg-black/5 px-3 py-2 text-xs font-semibold text-black dark:border-white dark:bg-white/10 dark:text-white"
                          : "flex items-center gap-2 rounded-lg border-2 border-black/15 px-3 py-2 text-xs font-medium text-black/60 dark:border-white/20 dark:text-white/60"
                      }
                    >
                      <span
                        className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 ${
                          metodoPago === "TARJETA" ? "border-black dark:border-white" : "border-black/30 dark:border-white/30"
                        }`}
                      >
                        {metodoPago === "TARJETA" && <span className="h-1.5 w-1.5 rounded-full bg-black dark:bg-white" />}
                      </span>
                      Tarjeta
                    </button>
                  ) : (
                    <span
                      aria-disabled="true"
                      className="flex cursor-not-allowed items-center gap-2 rounded-lg border-2 border-black/10 px-3 py-2 text-xs font-medium text-black/30 dark:border-white/10 dark:text-white/30"
                    >
                      <span className="h-3.5 w-3.5 rounded-full border-2 border-black/15 dark:border-white/15" />
                      Tarjeta — próximamente
                    </span>
                  )}

                  <span
                    aria-disabled="true"
                    className="flex cursor-not-allowed items-center gap-2 rounded-lg border-2 border-black/10 px-3 py-2 text-xs font-medium text-black/30 dark:border-white/10 dark:text-white/30"
                  >
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-black/15 dark:border-white/15" />
                    Transferencia — próximamente
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

              <PieFijo>
                <button type="submit" disabled={!canSubmit} className={BTN_PRIMARY}>
                  {submitting ? "Enviando..." : metodoPago === "TARJETA" ? "Continuar al pago" : "Confirmar pedido"}
                </button>
              </PieFijo>
            </form>
          </>
        )}

        {step === "pago-tarjeta" && order && order.clientSecret && (
          <TarjetaPagoStep
            slug={slug}
            order={order}
            total={total}
            onAtras={atras}
            onPagado={() => {
              irA("confirmation");
              onSuccess();
            }}
          />
        )}

        {step === "confirmation" && order && (
          <>
            <h2 className="text-lg font-semibold">¡Pedido recibido!</h2>
            {/* TARJETA es la única forma de pago que pasa por una confirmación
                asíncrona (Stripe + webhook) — el cliente necesita que se le
                diga explícitamente que ya se resolvió, para no quedarse
                esperando algo que ya pasó. EFECTIVO/TRANSFERENCIA se cobran
                al entregar/recoger, así que esta pantalla nunca debe insinuar
                que ya se cobró para esos métodos. */}
            {order.metodoPago === "TARJETA" && (
              <p className="text-sm font-medium text-black dark:text-white">
                Tu pago fue confirmado — no necesitas hacer nada más.
              </p>
            )}
            <p className="text-sm text-black/60 dark:text-white/60">
              Tu folio es <span className="font-semibold text-black dark:text-white">#{order.folio}</span>.{" "}
              {order.horaRecogidaTipo === "HORA_ESPECIFICA" && order.horaRecogida
                ? `${order.metodoEntrega === "DOMICILIO" ? "Te lo llevamos" : "Te esperamos"} ${
                    order.fechaEntrega ? `${etiquetaDia(order.fechaEntrega, fechaActualMexico()).toLowerCase()} ` : ""
                  }a las ${order.horaRecogida}.`
                : order.metodoEntrega === "DOMICILIO"
                  ? "Te avisaremos cuando salga a reparto."
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
              {order.metodoEntrega === "DOMICILIO" && (
                <div className="flex flex-col gap-0.5 text-sm">
                  <span className="text-black/60 dark:text-white/60">Dirección</span>
                  <span className="font-medium">
                    {order.direccionCalle} {order.direccionNumero}, {order.direccionColonia}
                  </span>
                  {order.direccionReferencias && (
                    <span className="text-xs text-black/50 dark:text-white/50">{order.direccionReferencias}</span>
                  )}
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
              onClick={cerrar}
              className="rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95 dark:bg-white dark:text-black"
            >
              Cerrar
            </button>
          </>
        )}
    </HojaInferior>
  );
}

/**
 * Wraps the actual card form in <Elements>, scoped to this one order's
 * clientSecret. Kept as its own component (not inline in CheckoutModal)
 * because useStripe()/useElements() only work inside an <Elements> provider —
 * they can't be called from the parent that renders it.
 */
// Contenedor del checkout: hoja anclada abajo con fondo muy oscuro (casi sólido, con blur) para que no distraiga el
// menú. Su altura sigue la del contenido (ResizeObserver) con transición, hasta un tope de 92 % de la pantalla; más
// allá scrollea por dentro (el encabezado y el botón principal de cada paso son sticky).
function HojaInferior({ children }: { children: React.ReactNode }) {
  const contenidoRef = useRef<HTMLDivElement>(null);
  const [alto, setAlto] = useState<number | null>(null);

  // Bloquea el scroll de la página de atrás mientras el checkout está abierto. En iOS Safari `overflow: hidden` en el
  // body no basta (el gesto se pasa a la página), así que se fija el body en su lugar y se restaura la posición al cerrar.
  useEffect(() => {
    const y = window.scrollY;
    const { position, top, left, right, width, overflow } = document.body.style;
    Object.assign(document.body.style, { position: "fixed", top: `-${y}px`, left: "0", right: "0", width: "100%", overflow: "hidden" });
    return () => {
      Object.assign(document.body.style, { position, top, left, right, width, overflow });
      window.scrollTo(0, y);
    };
  }, []);

  useEffect(() => {
    const el = contenidoRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(() => setAlto(el.getBoundingClientRect().height));
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 backdrop-blur-sm">
      <div
        className="hoja-checkout max-h-[92dvh] w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-lg transition-[height] duration-300 ease-out motion-reduce:transition-none dark:bg-chat-card-dark"
        style={alto != null ? { height: alto } : undefined}
      >
        <div className="h-full overflow-y-auto overscroll-contain">
          <div ref={contenidoRef} className="flex flex-col gap-4 p-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// Encabezado de cada pantalla: flecha (o X en la primera) + título, pegado arriba al hacer scroll.
function EncabezadoPantalla({
  titulo,
  onAtras,
  etiqueta = "Atrás",
  cerrar = false,
}: {
  titulo: string;
  onAtras: () => void;
  etiqueta?: string;
  cerrar?: boolean;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-6 -mt-6 flex items-center gap-1 bg-white px-4 pb-2 pt-4 dark:bg-chat-card-dark">
      <button
        type="button"
        onClick={onAtras}
        aria-label={etiqueta}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-black/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          {cerrar ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M15 5l-7 7 7 7" />}
        </svg>
      </button>
      <h2 className="text-lg font-semibold">{titulo}</h2>
    </div>
  );
}

// Botón principal del paso, fijo al borde inferior de la hoja (y al final del contenido si este es corto).
function PieFijo({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-auto flex flex-col bg-white px-6 pt-3 dark:bg-chat-card-dark"
      style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
    >
      {children}
    </div>
  );
}

function TarjetaPagoStep({
  slug,
  order,
  total,
  onAtras,
  onPagado,
}: {
  slug: string;
  order: PublicOrder;
  total: number;
  onAtras: () => void;
  onPagado: () => void;
}) {
  return (
    <Elements stripe={getStripe()} options={{ clientSecret: order.clientSecret! }}>
      <TarjetaPagoForm slug={slug} order={order} total={total} onAtras={onAtras} onPagado={onPagado} />
    </Elements>
  );
}

// Cuánto se espera al backend confirmar el pago (vía webhook de Stripe)
// antes de rendirse — ver el useEffect de polling más abajo.
const CONFIRMACION_POLL_INTERVAL_MS = 2000;
const CONFIRMACION_MAX_ESPERA_MS = 18000;

// Exportado únicamente para pruebas (ver checkout-modal.tarjeta-pago.test.tsx)
// — permite montarlo de forma aislada con useStripe()/useElements() y
// fetchPublicEstadoPago mockeados, sin tener que atravesar todo el flujo de
// carrito → entrega → datos → pago solo para llegar a este paso. No es parte
// de la API pública del módulo para nada más.
export function TarjetaPagoForm({
  slug,
  order,
  total,
  onAtras,
  onPagado,
}: {
  slug: string;
  order: PublicOrder;
  total: number;
  onAtras: () => void;
  onPagado: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Solo se llena con "succeeded" o "processing" — es lo único que hace que
  // se entre a la espera (ver handlePagar). Distingue, si se agota el tiempo
  // de espera sin que el backend confirme nada, entre "Stripe ya había dicho
  // que sí" (no se le puede decir al cliente que falló, sería falso e
  // induciría un posible doble cobro) y "ni Stripe sabía todavía" (ahí sí es
  // honesto tratarlo como fallo — ver el useEffect de abajo).
  const [respuestaStripe, setRespuestaStripe] = useState<"succeeded" | "processing" | null>(null);
  // Ref en vez de dependencia directa del efecto de abajo: onPagado se
  // recrea en cada render del padre (es un arrow function inline), y no
  // queremos que eso reinicie el cronómetro de espera cada vez que
  // CheckoutModal re-renderiza por cualquier otra razón mientras se espera
  // al backend.
  const onPagadoRef = useRef(onPagado);
  useEffect(() => {
    onPagadoRef.current = onPagado;
  }, [onPagado]);

  async function handlePagar(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setPaying(true);
    setError(null);

    // redirect: 'if_required' — card payments resolve synchronously; only
    // redirect-based methods (if the tenant's Stripe account has any enabled)
    // would leave this page, hence still needing a return_url.
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: "if_required",
    });

    if (confirmError) {
      // Rechazo síncrono (tarjeta rechazada, CVC inválido, etc.) — se queda
      // en el formulario, mismo pedido/folio, puede reintentar. Camino
      // mutuamente excluyente con la espera de abajo: nunca se llega a fijar
      // respuestaStripe en este caso.
      setError(confirmError.message ?? "No se pudo procesar el pago");
      setPaying(false);
      return;
    }

    if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") {
      // Ninguno de los dos significa "ya está confirmado" — solo que Stripe
      // no rechazó nada todavía. La confirmación real (el webhook llegando
      // al backend) se espera con polling en el useEffect de abajo, nunca
      // aquí directamente.
      setRespuestaStripe(paymentIntent.status);
      return;
    }

    setError("El pago no se completó — intenta de nuevo");
    setPaying(false);
  }

  // Polling de estadoPago mientras se espera que el webhook de Stripe llegue
  // al backend — ver PublicService.getEstadoPago (Fase 1). Se re-arma cada
  // vez que el cliente reintenta el pago (respuestaStripe vuelve a null tras
  // un fallo/timeout, luego se vuelve a fijar en un nuevo intento).
  useEffect(() => {
    if (!respuestaStripe) return;

    let cancelado = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const inicio = Date.now();

    async function poll() {
      if (cancelado) return;

      try {
        const { estadoPago } = await fetchPublicEstadoPago(slug, order.id);
        if (cancelado) return;

        if (estadoPago === "PAGADO") {
          onPagadoRef.current();
          return;
        }

        if (estadoPago === "FALLIDO") {
          setRespuestaStripe(null);
          setError("El pago no se pudo confirmar — intenta de nuevo");
          setPaying(false);
          return;
        }
        // PENDIENTE/PROCESANDO: todavía sin veredicto del backend, se sigue
        // esperando (salvo que ya se haya agotado el tiempo, revisado abajo).
      } catch {
        // Hiccup de red consultando el estado — no es un fallo del pago en
        // sí, se reintenta en el siguiente tick salvo que ya se acabó el
        // tiempo de espera.
      }

      if (cancelado) return;

      if (Date.now() - inicio >= CONFIRMACION_MAX_ESPERA_MS) {
        if (respuestaStripe === "succeeded") {
          // Stripe ya confirmó el cobro del lado del cliente — solo falta
          // que el webhook se refleje en el backend. Decirle al cliente que
          // falló sería falso y lo empujaría a un posible doble cobro si
          // reintenta, así que se confía en la respuesta que Stripe ya dio.
          onPagadoRef.current();
        } else {
          // "processing": ni Stripe mismo sabía el resultado. Sin
          // confirmación de nadie, es honesto tratarlo como fallo.
          setRespuestaStripe(null);
          setError("No pudimos confirmar tu pago a tiempo — intenta de nuevo");
          setPaying(false);
        }
        return;
      }

      timeoutId = setTimeout(poll, CONFIRMACION_POLL_INTERVAL_MS);
    }

    timeoutId = setTimeout(poll, CONFIRMACION_POLL_INTERVAL_MS);
    return () => {
      cancelado = true;
      clearTimeout(timeoutId);
    };
  }, [respuestaStripe, slug, order.id]);

  if (respuestaStripe) {
    return (
      <>
        <h2 className="text-lg font-semibold">Confirmando tu pago...</h2>
        <p className="text-sm text-black/60 dark:text-white/60">
          Folio <span className="font-semibold text-black dark:text-white">#{order.folio}</span> — esto toma unos
          segundos, no cierres esta ventana.
        </p>
        <div className="flex items-center justify-center py-6">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-black/20 border-t-black dark:border-white/20 dark:border-t-white" />
        </div>
      </>
    );
  }

  return (
    <>
      <EncabezadoPantalla titulo="Pago con tarjeta" onAtras={onAtras} />

      <p className="text-sm text-black/60 dark:text-white/60">
        Folio <span className="font-semibold text-black dark:text-white">#{order.folio}</span> — Total ${total.toFixed(2)}
      </p>

      <form onSubmit={handlePagar} className="flex flex-col gap-3">
        <PaymentElement />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={!stripe || paying} className={BTN_PRIMARY}>
          {paying ? "Procesando..." : `Pagar $${total.toFixed(2)}`}
        </button>
      </form>
    </>
  );
}
