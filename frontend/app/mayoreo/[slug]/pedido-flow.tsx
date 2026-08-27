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

const BTN_PRIMARY =
  "rounded-lg bg-mayoreo-button px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_SECONDARY = "rounded-lg border border-mayoreo-border px-4 py-3 text-sm font-semibold text-mayoreo-ink-soft hover:bg-mayoreo-bg";
const BACK_LINK = "self-start text-sm text-mayoreo-ink-soft hover:text-mayoreo-ink";
const CARD = "flex flex-col gap-2 rounded-xl bg-mayoreo-card p-4 shadow-sm";

function distribucionVacia(): Distribucion {
  return DIAS_SEMANA_PEDIDO_B2B.reduce((acc, { value }) => {
    acc[value] = 0;
    return acc;
  }, {} as Distribucion);
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

  // Reparte el total de este producto entre los 7 días lo más parejo
  // posible; si no divide exacto, el resto (1 pieza extra por día) se asigna
  // empezando por el primer día de la semana.
  function repartirParejo(productId: string) {
    const total = cart[productId] ?? 0;
    const dias = DIAS_SEMANA_PEDIDO_B2B.length;
    const base = Math.floor(total / dias);
    const resto = total % dias;
    const nueva = distribucionVacia();
    DIAS_SEMANA_PEDIDO_B2B.forEach(({ value }, index) => {
      nueva[value] = base + (index < resto ? 1 : 0);
    });
    setDistribuciones((prev) => ({ ...prev, [productId]: nueva }));
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

        {productIds.map((id) => {
          const distribuido = totalDistribuido(id);
          return (
            <div key={id} className={CARD}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-mayoreo-ink">{nombreProducto(id)}</span>
                <button
                  type="button"
                  onClick={() => repartirParejo(id)}
                  className="shrink-0 text-xs font-semibold text-mayoreo-accent hover:underline"
                >
                  Repartir parejo
                </button>
              </div>
              <span className="text-xs text-mayoreo-ink-soft">
                distribuido {distribuido} de {cart[id]} total
              </span>
              <div className="grid grid-cols-7 gap-1.5">
                {DIAS_SEMANA_PEDIDO_B2B.map(({ value }, offset) => (
                  <label key={value} className="flex flex-col items-center gap-1">
                    <span className="text-center text-[10px] font-medium leading-tight text-mayoreo-ink-soft">
                      {etiquetaDiaConFecha(semanaDestino.inicio, offset)}
                    </span>
                    <input
                      type="number"
                      min={0}
                      value={distribuciones[id]?.[value] ?? 0}
                      onChange={(e) => setDia(id, value, Number(e.target.value) || 0)}
                      className="mayoreo-input dia-input w-full px-1 py-1.5 text-center text-sm"
                    />
                  </label>
                ))}
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => onScreenChange("resumen")}
          disabled={!todoDistribuido}
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
