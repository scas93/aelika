"use client";

import { useState } from "react";
import {
  ApiError,
  createPublicPedidoB2b,
  previewPedidoB2bCodigoDescuento,
  DIAS_SEMANA_PEDIDO_B2B,
  type DiaSemanaPedidoB2b,
  type FacturacionModo,
  type PedidoB2bSemanaDestino,
  type PublicPedidoB2b,
  type PublicPedidoB2bCatalog,
} from "@/lib/api";
import { etiquetaDiaConFecha, rangoSemanaTexto } from "@/lib/pedido-b2b-fechas";
import { REGIMEN_FISCAL, USO_CFDI } from "@/lib/catalogos-sat";

// Pantallas del flujo de checkout, una vez que el catálogo y el carrito ya
// quedaron atrás — se muestran dentro del <main> de MayoreoPage como
// contenido normal de la página (nunca como modal/overlay: sin fondo
// oscurecido, sin botón "X", navegación con links "Atrás" como el resto del
// flujo). "confirmacion" no tiene vuelta atrás.
export type PedidoFlowScreen = "distribucion" | "resumen" | "confirmacion";

type Distribucion = Record<DiaSemanaPedidoB2b, number>;
type DiasActivos = Record<DiaSemanaPedidoB2b, boolean>;

const BTN_PRIMARY =
  "rounded-lg bg-mayoreo-button px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_SECONDARY = "rounded-lg border border-mayoreo-border px-4 py-3 text-sm font-semibold text-mayoreo-ink-soft hover:bg-mayoreo-bg";
const BACK_LINK = "self-start text-sm text-mayoreo-ink-soft hover:text-mayoreo-ink";
const CARD = "flex flex-col gap-2 rounded-xl bg-mayoreo-card p-4 shadow-sm";

const STEPPER_BTN =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-mayoreo-border text-base font-semibold text-mayoreo-ink hover:bg-mayoreo-bg disabled:cursor-not-allowed disabled:opacity-40";
// Miniatura del producto en el header de cada card (expandida y colapsada) —
// mismo círculo con inicial de respaldo que ya usa el resto de la app para
// avatares sin foto (ver tenantInitial en dashboard/nav.tsx), aplicado aquí
// con los tokens mayoreo-* en vez de admin-*.
const THUMB =
  "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-mayoreo-bg text-xs font-semibold text-mayoreo-ink-soft";

function distribucionVacia(): Distribucion {
  return DIAS_SEMANA_PEDIDO_B2B.reduce((acc, { value }) => {
    acc[value] = 0;
    return acc;
  }, {} as Distribucion);
}

// Todos los días activos por default — mismo punto de partida que la
// versión anterior de esta pantalla, donde los 7 días estaban disponibles
// para escribir una cantidad sin necesidad de "activarlos" primero.
function diasActivosDefault(): DiasActivos {
  return DIAS_SEMANA_PEDIDO_B2B.reduce((acc, { value }) => {
    acc[value] = true;
    return acc;
  }, {} as DiasActivos);
}

export default function PedidoFlow({
  slug,
  catalog,
  cart,
  minimoPiezas,
  facturacionModo,
  semanaDestino,
  screen,
  onScreenChange,
  onBackToCarrito,
  onFinish,
}: {
  slug: string;
  catalog: PublicPedidoB2bCatalog;
  cart: Record<string, number>;
  minimoPiezas: number;
  facturacionModo: FacturacionModo;
  semanaDestino: PedidoB2bSemanaDestino;
  screen: PedidoFlowScreen;
  onScreenChange: (screen: PedidoFlowScreen) => void;
  onBackToCarrito: () => void;
  onFinish: () => void;
}) {
  const productos = catalog.categories.flatMap((c) => c.products);
  const productIds = Object.keys(cart).filter((id) => cart[id] > 0);

  const [distribuciones, setDistribuciones] = useState<Record<string, Distribucion>>(() =>
    Object.fromEntries(productIds.map((id) => [id, distribucionVacia()])),
  );
  const [diasActivos, setDiasActivos] = useState<Record<string, DiasActivos>>(() =>
    Object.fromEntries(productIds.map((id) => [id, diasActivosDefault()])),
  );
  // Acordeón: un solo producto expandido a la vez. Al montar, nada está
  // distribuido todavía, así que "el primero incompleto" es simplemente el
  // primer producto del carrito.
  const [expandedId, setExpandedId] = useState<string | null>(() => productIds[0] ?? null);

  const [codigoInput, setCodigoInput] = useState("");
  const [codigoAplicado, setCodigoAplicado] = useState<{ texto: string; porcentaje: number } | null>(null);
  const [codigoError, setCodigoError] = useState<string | null>(null);
  const [validandoCodigo, setValidandoCodigo] = useState(false);

  const [negocioNombre, setNegocioNombre] = useState("");
  const [contactoNombre, setContactoNombre] = useState("");
  const [contactoTelefono, setContactoTelefono] = useState("");
  const [contactoCorreo, setContactoCorreo] = useState("");

  // Facturación — mismo mecanismo que checkout-modal.tsx en /tienda (B2C):
  // requiereFactura solo importa cuando facturacionModo === "OPCIONAL" (el
  // checkbox); con "OBLIGATORIO" el formulario siempre se exige sin
  // checkbox, y con "DESACTIVADO" no se muestra nada de esto.
  const [requiereFactura, setRequiereFactura] = useState(false);
  const [facturaRazonSocial, setFacturaRazonSocial] = useState("");
  const [facturaRfc, setFacturaRfc] = useState("");
  const [facturaRegimenFiscal, setFacturaRegimenFiscal] = useState("");
  const [facturaUsoCfdi, setFacturaUsoCfdi] = useState("");
  const [facturaCodigoPostal, setFacturaCodigoPostal] = useState("");
  const [facturaCorreo, setFacturaCorreo] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pedidoCreado, setPedidoCreado] = useState<PublicPedidoB2b | null>(null);

  function nombreProducto(id: string) {
    return productos.find((p) => p.id === id)?.nombre ?? "Producto";
  }

  function precioProducto(id: string) {
    return Number(productos.find((p) => p.id === id)?.precio ?? 0);
  }

  function setDia(productId: string, dia: DiaSemanaPedidoB2b, cantidad: number) {
    setDistribuciones((prev) => ({
      ...prev,
      [productId]: { ...prev[productId], [dia]: Math.max(0, cantidad) } as Distribucion,
    }));
  }

  function totalDistribuido(productId: string) {
    const dist = distribuciones[productId] ?? distribucionVacia();
    return DIAS_SEMANA_PEDIDO_B2B.reduce((sum, { value }) => sum + (dist[value] ?? 0), 0);
  }

  // Reparte el total de este producto entre los días marcados como activos
  // lo más parejo posible; si no divide exacto, el resto (1 pieza extra por
  // día) se asigna empezando por el primer día activo de la semana. Los días
  // inactivos quedan en 0 (distribucionVacia ya parte de ahí).
  function repartirParejo(productId: string) {
    const total = cart[productId] ?? 0;
    const activos = diasActivos[productId] ?? diasActivosDefault();
    const diasActivosLista = DIAS_SEMANA_PEDIDO_B2B.filter(({ value }) => activos[value]);
    if (diasActivosLista.length === 0) return;
    const base = Math.floor(total / diasActivosLista.length);
    const resto = total % diasActivosLista.length;
    const nueva = distribucionVacia();
    diasActivosLista.forEach(({ value }, index) => {
      nueva[value] = base + (index < resto ? 1 : 0);
    });
    setDistribuciones((prev) => ({ ...prev, [productId]: nueva }));
  }

  // Marca/desmarca un día como activo para este producto. Al desactivar un
  // día que ya tenía piezas asignadas, esas piezas regresan al restante (se
  // ponen en 0) en vez de quedar fantasma en el total distribuido.
  function toggleDia(productId: string, dia: DiaSemanaPedidoB2b) {
    const activoActual = diasActivos[productId]?.[dia] ?? true;
    const siguienteActivo = !activoActual;
    setDiasActivos((prev) => ({
      ...prev,
      [productId]: { ...(prev[productId] ?? diasActivosDefault()), [dia]: siguienteActivo },
    }));
    if (!siguienteActivo) {
      setDia(productId, dia, 0);
    }
  }

  function incrementarDia(productId: string, dia: DiaSemanaPedidoB2b) {
    const total = cart[productId] ?? 0;
    if (totalDistribuido(productId) >= total) return;
    setDia(productId, dia, (distribuciones[productId]?.[dia] ?? 0) + 1);
  }

  function decrementarDia(productId: string, dia: DiaSemanaPedidoB2b) {
    const actual = distribuciones[productId]?.[dia] ?? 0;
    if (actual <= 0) return;
    setDia(productId, dia, actual - 1);
  }

  const todoDistribuido = productIds.every((id) => totalDistribuido(id) === cart[id]);

  const subtotal = productIds.reduce((sum, id) => sum + precioProducto(id) * cart[id], 0);
  const totalPiezas = productIds.reduce((sum, id) => sum + cart[id], 0);
  const descuentoTotal = codigoAplicado ? Math.round(subtotal * (codigoAplicado.porcentaje / 100) * 100) / 100 : 0;
  const total = subtotal - descuentoTotal;

  const faltantePiezas = Math.max(0, minimoPiezas - totalPiezas);
  const alcanzaMinimo = totalPiezas >= minimoPiezas;

  const datosCompletos =
    negocioNombre.trim().length >= 2 &&
    contactoNombre.trim().length >= 2 &&
    contactoTelefono.trim().length >= 7 &&
    /\S+@\S+\.\S+/.test(contactoCorreo);

  const facturaRequerida = facturacionModo === "OBLIGATORIO" || (facturacionModo === "OPCIONAL" && requiereFactura);
  const facturaCompleta =
    facturaRazonSocial.trim() !== "" &&
    facturaRfc.trim() !== "" &&
    facturaRegimenFiscal.trim() !== "" &&
    facturaUsoCfdi.trim() !== "" &&
    facturaCodigoPostal.trim() !== "" &&
    facturaCorreo.trim() !== "";

  const canSubmit = alcanzaMinimo && datosCompletos && (!facturaRequerida || facturaCompleta) && !submitting;

  async function validarCodigo() {
    if (!codigoInput.trim()) return;
    setValidandoCodigo(true);
    setCodigoError(null);
    try {
      const { descuentoPorcentaje } = await previewPedidoB2bCodigoDescuento(slug, codigoInput.trim());
      setCodigoAplicado({ texto: codigoInput.trim().toUpperCase(), porcentaje: descuentoPorcentaje });
    } catch (err) {
      setCodigoAplicado(null);
      setCodigoError(err instanceof ApiError ? err.message : "No se pudo validar el código");
    } finally {
      setValidandoCodigo(false);
    }
  }

  function quitarCodigo() {
    setCodigoAplicado(null);
    setCodigoInput("");
    setCodigoError(null);
  }

  async function confirmarPedido() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const pedido = await createPublicPedidoB2b(slug, {
        negocioNombre: negocioNombre.trim(),
        contactoNombre: contactoNombre.trim(),
        contactoTelefono: contactoTelefono.trim(),
        contactoCorreo: contactoCorreo.trim(),
        semanaInicio: semanaDestino.inicio,
        codigoDescuento: codigoAplicado?.texto,
        requiereFactura: facturaRequerida || undefined,
        facturaRazonSocial: facturaRequerida ? facturaRazonSocial.trim() : undefined,
        facturaRfc: facturaRequerida ? facturaRfc.trim() : undefined,
        facturaRegimenFiscal: facturaRequerida ? facturaRegimenFiscal.trim() : undefined,
        facturaUsoCfdi: facturaRequerida ? facturaUsoCfdi.trim() : undefined,
        facturaCodigoPostal: facturaRequerida ? facturaCodigoPostal.trim() : undefined,
        facturaCorreo: facturaRequerida ? facturaCorreo.trim() : undefined,
        items: productIds.map((id) => ({
          productId: id,
          distribucion: DIAS_SEMANA_PEDIDO_B2B.map(({ value }) => ({
            dia: value,
            cantidad: distribuciones[id]?.[value] ?? 0,
          })).filter((d) => d.cantidad > 0),
        })),
      });
      setPedidoCreado(pedido);
      onScreenChange("confirmacion");
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "No se pudo enviar tu pedido");
    } finally {
      setSubmitting(false);
    }
  }

  if (screen === "distribucion") {
    return (
      <div className="flex flex-col gap-4">
        <button type="button" onClick={onBackToCarrito} className={BACK_LINK}>
          ← Atrás
        </button>

        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-mayoreo-ink">Reparte tu pedido por día de entrega</h1>
          <p className="text-sm font-semibold text-mayoreo-accent">
            Semana del {rangoSemanaTexto(semanaDestino.inicio, semanaDestino.fin)}
          </p>
          <p className="text-sm text-mayoreo-ink-soft">
            Asigna cuántas piezas de cada producto se entregan cada día. Debes distribuir el total de cada producto.
          </p>
        </div>

        {!todoDistribuido && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Distribuye el total de cada producto para continuar.
          </p>
        )}

        {!alcanzaMinimo && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Tu pedido tiene {totalPiezas} piezas. Te faltan {faltantePiezas} piezas para alcanzar el mínimo de{" "}
            {minimoPiezas}.
          </p>
        )}

        {productIds.map((id) => {
          const producto = productos.find((p) => p.id === id);
          const distribuido = totalDistribuido(id);
          const total = cart[id] ?? 0;
          const completo = distribuido === total;
          const isExpanded = expandedId === id;
          const activos = diasActivos[id] ?? diasActivosDefault();
          const diasConFecha = DIAS_SEMANA_PEDIDO_B2B.map(({ value, label }, offset) => ({
            value,
            label,
            fecha: etiquetaDiaConFecha(semanaDestino.inicio, offset),
          }));
          const algunDiaActivo = diasConFecha.some(({ value }) => activos[value]);

          const thumb = (
            <span className={THUMB}>
              {producto?.fotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- external, tenant-provided URLs
                <img src={producto.fotoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                nombreProducto(id).trim().charAt(0).toUpperCase() || "?"
              )}
            </span>
          );

          return (
            <div key={id} className={CARD}>
              {/* flex-wrap en vez de truncate en el nombre — con "Repartir
                  parejo" + el badge compartiendo la fila, un nombre de
                  producto largo en pantalla angosta ya no cabía y se
                  recortaba ("Espiral de n..."); ahora, si no alcanza, las
                  acciones bajan a su propia línea dentro del mismo header en
                  vez de cortar el nombre. */}
              <div className="flex w-full flex-wrap items-center justify-between gap-x-2 gap-y-1">
                {/* role="button" en un <div>, no un <button> real — evita anidar
                    el botón "Repartir parejo" (acción propia, con su propio
                    stopPropagation) dentro de otro botón, que sería HTML
                    inválido. Mismo patrón que la tarjeta de producto clickeable
                    en page.tsx. */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedId((current) => (current === id ? null : id))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedId((current) => (current === id ? null : id));
                    }
                  }}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                >
                  <span className="shrink-0 text-mayoreo-ink-soft">{isExpanded ? "▼" : "▶"}</span>
                  {thumb}
                  <span className="text-sm font-semibold text-mayoreo-ink">{nombreProducto(id)}</span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {isExpanded && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        repartirParejo(id);
                      }}
                      disabled={!algunDiaActivo}
                      className="text-xs font-semibold text-mayoreo-accent hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
                    >
                      Repartir parejo
                    </button>
                  )}
                  <span
                    className={`flex items-center gap-1 text-xs font-medium ${
                      completo ? "text-emerald-600" : "text-amber-600"
                    }`}
                  >
                    {completo && <span aria-hidden>✓</span>}
                    {distribuido} de {total}
                  </span>
                </div>
              </div>

              {isExpanded && (
                <div className="flex flex-col gap-1 border-t border-mayoreo-border pt-3">
                  {diasConFecha.map(({ value, fecha }) => {
                    const activo = activos[value];
                    const cantidad = distribuciones[id]?.[value] ?? 0;
                    return (
                      <div
                        key={value}
                        className={`flex items-center justify-between gap-2 rounded-lg px-1 py-1.5 ${
                          activo ? "" : "opacity-50"
                        }`}
                      >
                        <label className="flex items-center gap-2 text-sm text-mayoreo-ink">
                          <input
                            type="checkbox"
                            checked={activo}
                            onChange={() => toggleDia(id, value)}
                            className="h-4 w-4 accent-mayoreo-accent"
                          />
                          {fecha}
                        </label>
                        {activo ? (
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => decrementarDia(id, value)}
                              disabled={cantidad <= 0}
                              className={STEPPER_BTN}
                              aria-label={`Quitar una pieza el ${fecha}`}
                            >
                              −
                            </button>
                            <span className="w-6 text-center text-base font-semibold text-mayoreo-ink">
                              {cantidad}
                            </span>
                            <button
                              type="button"
                              onClick={() => incrementarDia(id, value)}
                              disabled={distribuido >= total}
                              className={STEPPER_BTN}
                              aria-label={`Agregar una pieza el ${fecha}`}
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-mayoreo-ink-soft">Excluido</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => onScreenChange("resumen")}
          disabled={!todoDistribuido || !alcanzaMinimo}
          className={`${BTN_PRIMARY} w-full`}
        >
          Continuar
        </button>
      </div>
    );
  }

  if (screen === "resumen") {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-semibold text-mayoreo-ink">Resumen de tu pedido</h2>
            <span className="text-xs font-medium text-mayoreo-ink-soft">
              Semana del {rangoSemanaTexto(semanaDestino.inicio, semanaDestino.fin)}
            </span>
          </div>
          <button type="button" onClick={() => onScreenChange("distribucion")} className={BACK_LINK}>
            Atrás
          </button>
        </div>

        <div className={CARD}>
          <h3 className="text-sm font-semibold text-mayoreo-ink">Tu pedido</h3>
          <div className="flex flex-col gap-3">
            {productIds.map((id) => (
              <div key={id} className="flex flex-col gap-1 border-b border-mayoreo-border pb-2 last:border-0 last:pb-0">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-mayoreo-ink">
                    {nombreProducto(id)} × {cart[id]}
                  </span>
                  <span className="text-mayoreo-ink-soft">${(precioProducto(id) * cart[id]).toFixed(2)}</span>
                </div>
                <span className="text-xs text-mayoreo-ink-soft">
                  {DIAS_SEMANA_PEDIDO_B2B.filter(({ value }) => (distribuciones[id]?.[value] ?? 0) > 0)
                    .map(({ value, label }) => `${label} ${distribuciones[id][value]}`)
                    .join(" · ")}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1 border-t border-mayoreo-border pt-3 text-sm">
            <div className="flex justify-between text-mayoreo-ink-soft">
              <span>Subtotal</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            {codigoAplicado && (
              <div className="flex justify-between font-semibold text-red-600">
                <span>Descuento ({codigoAplicado.texto}, -{codigoAplicado.porcentaje}%)</span>
                <span>-${descuentoTotal.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-semibold text-mayoreo-ink">
              <span>Total estimado</span>
              <span>${total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className={CARD}>
          <h3 className="text-sm font-semibold text-mayoreo-ink">Código de promoción (opcional)</h3>
          <div className="flex gap-2">
            <input
              className="mayoreo-input flex-1"
              placeholder="Código"
              value={codigoInput}
              onChange={(e) => setCodigoInput(e.target.value)}
              disabled={!!codigoAplicado}
            />
            {codigoAplicado ? (
              <button type="button" onClick={quitarCodigo} className={BTN_SECONDARY}>
                Quitar
              </button>
            ) : (
              <button
                type="button"
                onClick={validarCodigo}
                disabled={validandoCodigo || !codigoInput.trim()}
                className={BTN_PRIMARY}
              >
                {validandoCodigo ? "Validando..." : "Aplicar"}
              </button>
            )}
          </div>
          {codigoError && <p className="text-xs text-red-600">{codigoError}</p>}
          {codigoAplicado && (
            <p className="text-xs font-semibold text-red-600">
              Código {codigoAplicado.texto} aplicado: -{codigoAplicado.porcentaje}%
            </p>
          )}
        </div>

        <div className={CARD}>
          <h3 className="text-sm font-semibold text-mayoreo-ink">Datos de tu negocio</h3>
          <div className="flex flex-col gap-3">
            <input
              className="mayoreo-input"
              placeholder="Nombre del negocio"
              value={negocioNombre}
              onChange={(e) => setNegocioNombre(e.target.value)}
            />
            <input
              className="mayoreo-input"
              placeholder="Nombre de contacto"
              value={contactoNombre}
              onChange={(e) => setContactoNombre(e.target.value)}
            />
            <input
              className="mayoreo-input"
              placeholder="Teléfono"
              value={contactoTelefono}
              onChange={(e) => setContactoTelefono(e.target.value)}
            />
            <input
              className="mayoreo-input"
              type="email"
              placeholder="Correo electrónico"
              value={contactoCorreo}
              onChange={(e) => setContactoCorreo(e.target.value)}
            />
          </div>
        </div>

        {facturacionModo !== "DESACTIVADO" && (
          <div className={CARD}>
            {facturacionModo === "OPCIONAL" ? (
              <label className="flex items-center gap-2 text-sm font-medium text-mayoreo-ink">
                <input
                  type="checkbox"
                  checked={requiereFactura}
                  onChange={(e) => setRequiereFactura(e.target.checked)}
                />
                Quiero factura
              </label>
            ) : (
              <span className="text-sm font-medium text-mayoreo-ink">Datos de facturación</span>
            )}

            {facturaRequerida && (
              <div className="flex flex-col gap-2">
                <input
                  required
                  placeholder="Nombre / razón social"
                  value={facturaRazonSocial}
                  onChange={(e) => setFacturaRazonSocial(e.target.value)}
                  className="mayoreo-input"
                />
                <input
                  required
                  placeholder="RFC"
                  value={facturaRfc}
                  onChange={(e) => setFacturaRfc(e.target.value)}
                  className="mayoreo-input"
                />
                <select
                  required
                  value={facturaRegimenFiscal}
                  onChange={(e) => setFacturaRegimenFiscal(e.target.value)}
                  className="mayoreo-input"
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
                <select
                  required
                  value={facturaUsoCfdi}
                  onChange={(e) => setFacturaUsoCfdi(e.target.value)}
                  className="mayoreo-input"
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
                <input
                  required
                  placeholder="Código postal fiscal"
                  value={facturaCodigoPostal}
                  onChange={(e) => setFacturaCodigoPostal(e.target.value)}
                  className="mayoreo-input"
                />
                <input
                  required
                  type="email"
                  placeholder="Correo electrónico"
                  value={facturaCorreo}
                  onChange={(e) => setFacturaCorreo(e.target.value)}
                  className="mayoreo-input"
                />
              </div>
            )}
          </div>
        )}

        {!alcanzaMinimo && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Tu pedido tiene {totalPiezas} piezas. Te faltan {faltantePiezas} piezas para alcanzar el mínimo de{" "}
            {minimoPiezas}.
          </p>
        )}
        {submitError && <p className="text-sm text-red-600">{submitError}</p>}

        <div className="flex gap-3">
          <button type="button" onClick={() => onScreenChange("distribucion")} className={`${BTN_SECONDARY} flex-1`}>
            Atrás
          </button>
          <button type="button" onClick={confirmarPedido} disabled={!canSubmit} className={`${BTN_PRIMARY} flex-1`}>
            {submitting ? "Enviando..." : "Confirmar pedido"}
          </button>
        </div>
      </div>
    );
  }

  if (!pedidoCreado) return null;

  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-mayoreo-accent-soft text-2xl">✓</div>
      <h2 className="text-lg font-semibold text-mayoreo-ink">Pedido enviado, pendiente de confirmación</h2>
      <p className="text-sm text-mayoreo-ink-soft">Se facturará al finalizar la semana.</p>
      <p className="text-xs text-mayoreo-ink-soft">Folio #{pedidoCreado.folio}</p>
      <p className="text-xs font-semibold text-mayoreo-ink-soft">
        Semana del {rangoSemanaTexto(semanaDestino.inicio, semanaDestino.fin)}
      </p>

      {pedidoCreado.requiereFactura && (
        <div className={`${CARD} w-full text-left`}>
          <span className="text-xs font-semibold uppercase tracking-wide text-mayoreo-ink-soft">Factura</span>
          <div className="flex items-center justify-between text-sm">
            <span className="text-mayoreo-ink-soft">Razón social</span>
            <span className="font-medium text-mayoreo-ink">{pedidoCreado.facturaRazonSocial}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-mayoreo-ink-soft">RFC</span>
            <span className="font-medium text-mayoreo-ink">{pedidoCreado.facturaRfc}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-mayoreo-ink-soft">Correo</span>
            <span className="font-medium text-mayoreo-ink">{pedidoCreado.facturaCorreo}</span>
          </div>
        </div>
      )}

      <button type="button" onClick={onFinish} className={`${BTN_PRIMARY} mt-4 w-full`}>
        Cerrar
      </button>
    </div>
  );
}
