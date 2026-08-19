"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  createPromotion,
  deletePromotion,
  fetchProducts,
  fetchPromotions,
  updatePromotion,
  type ComboConfig,
  type DescuentoProductoConfig,
  type Product,
  type Promotion,
  type PromotionTipo,
} from "@/lib/api";

const CARD = "rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]";
const BTN_PRIMARY =
  "self-start rounded-lg bg-admin-green px-4 py-2 text-sm font-bold text-white transition hover:bg-admin-green-dark disabled:cursor-not-allowed disabled:opacity-40";
const BTN_SECONDARY =
  "rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-bold text-admin-ink/70 transition hover:bg-admin-bg";

export default function PromotionsSection({ token, canWrite }: { token: string; canWrite: boolean }) {
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [promos, prods] = await Promise.all([fetchPromotions(token), fetchProducts(token)]);
      setPromotions(promos);
      setProducts(prods);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las promociones");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function productName(id: string) {
    return products.find((p) => p.id === id)?.nombre ?? "(producto eliminado)";
  }

  function describe(promo: Promotion) {
    if (promo.tipo === "DESCUENTO_PRODUCTO") {
      const config = promo.config as DescuentoProductoConfig;
      const monto = config.tipoDescuento === "porcentaje" ? `${config.valor}%` : `$${config.valor}`;
      return `${productName(config.productId)} — ${monto} de descuento`;
    }
    const config = promo.config as ComboConfig;
    return `Combo: ${config.productIds.map(productName).join(" + ")} — $${config.precioCombo}`;
  }

  async function handleToggleActiva(promo: Promotion) {
    setPromotions((prev) => (prev ? prev.map((p) => (p.id === promo.id ? { ...p, activa: !promo.activa } : p)) : prev));
    await updatePromotion(token, promo.id, { activa: !promo.activa });
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deletePromotion(token, id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar la promoción");
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-extrabold uppercase tracking-wide text-admin-ink/55">Promociones</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {promotions === null ? (
        <p className="text-sm text-admin-ink/55">Cargando...</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {promotions.length === 0 && (
            <li className={`${CARD} p-4 text-sm text-admin-ink/55`}>Aún no tienes promociones.</li>
          )}
          {promotions.map((promo) => (
            <li key={promo.id} className={`${CARD} flex items-center justify-between gap-3 p-3`}>
              <div className="flex items-center gap-2">
                <span className={promo.activa ? "text-sm font-bold text-admin-ink" : "text-sm font-bold text-admin-ink/40"}>
                  {describe(promo)}
                </span>
                {!promo.activa && (
                  <span className="rounded-full bg-admin-bg px-2 py-0.5 text-xs font-medium text-admin-ink/55">
                    Inactiva
                  </span>
                )}
              </div>
              {canWrite && (
                <div className="flex items-center gap-2">
                  <button onClick={() => handleToggleActiva(promo)} className={BTN_SECONDARY}>
                    {promo.activa ? "Desactivar" : "Activar"}
                  </button>
                  <button onClick={() => handleDelete(promo.id)} className={BTN_SECONDARY}>
                    Eliminar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <NewPromotionForm
          products={products}
          onCreate={async (payload) => {
            await createPromotion(token, payload);
            await load();
          }}
        />
      )}
    </section>
  );
}

function NewPromotionForm({
  products,
  onCreate,
}: {
  products: Product[];
  onCreate: (payload: { tipo: PromotionTipo; config: DescuentoProductoConfig | ComboConfig }) => Promise<void>;
}) {
  const [tipo, setTipo] = useState<PromotionTipo>("DESCUENTO_PRODUCTO");
  const [productId, setProductId] = useState("");
  const [tipoDescuento, setTipoDescuento] = useState<"porcentaje" | "monto_fijo">("porcentaje");
  const [valor, setValor] = useState("");
  const [productIds, setProductIds] = useState<string[]>([]);
  const [precioCombo, setPrecioCombo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleProductId(id: string) {
    setProductIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let config: DescuentoProductoConfig | ComboConfig;
    if (tipo === "DESCUENTO_PRODUCTO") {
      const valorNumber = Number(valor);
      if (!productId || !Number.isFinite(valorNumber) || valorNumber <= 0) return;
      config = { productId, tipoDescuento, valor: valorNumber };
    } else {
      const precioNumber = Number(precioCombo);
      if (productIds.length < 2 || !Number.isFinite(precioNumber) || precioNumber <= 0) return;
      config = { productIds, precioCombo: precioNumber };
    }

    setSubmitting(true);
    try {
      await onCreate({ tipo, config });
      setProductId("");
      setValor("");
      setProductIds([]);
      setPrecioCombo("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la promoción");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`${CARD} flex flex-col gap-3 p-4`}>
      <p className="text-sm font-extrabold text-admin-ink">Nueva promoción</p>

      <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
        Tipo
        <select value={tipo} onChange={(e) => setTipo(e.target.value as PromotionTipo)} className="input">
          <option value="DESCUENTO_PRODUCTO">Descuento en un producto</option>
          <option value="COMBO">Combo de productos</option>
        </select>
      </label>

      {tipo === "DESCUENTO_PRODUCTO" ? (
        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
            Producto
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input">
              <option value="">Selecciona...</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
            Tipo de descuento
            <select
              value={tipoDescuento}
              onChange={(e) => setTipoDescuento(e.target.value as "porcentaje" | "monto_fijo")}
              className="input"
            >
              <option value="porcentaje">Porcentaje</option>
              <option value="monto_fijo">Monto fijo</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
            Valor
            <input
              type="number"
              min="0"
              step="0.01"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder={tipoDescuento === "porcentaje" ? "15" : "20.00"}
              className="input"
            />
          </label>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
            Productos del combo (elige al menos 2)
            <div className="flex flex-col gap-1 rounded-lg border border-black/10 p-2">
              {products.length === 0 && (
                <span className="text-sm font-normal text-admin-ink/55">No hay productos aún.</span>
              )}
              {products.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm font-normal text-admin-ink">
                  <input type="checkbox" checked={productIds.includes(p.id)} onChange={() => toggleProductId(p.id)} />
                  {p.nombre}
                </label>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
            Precio del combo
            <input
              type="number"
              min="0"
              step="0.01"
              value={precioCombo}
              onChange={(e) => setPrecioCombo(e.target.value)}
              placeholder="199.00"
              className="input"
            />
          </label>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" disabled={submitting} className={BTN_PRIMARY}>
        Crear promoción
      </button>
    </form>
  );
}
