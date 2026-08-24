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
import Card from "../_components/Card";
import Button from "../_components/Button";
import Badge from "../_components/Badge";

const SECTION_HEADER = "text-[13px] font-semibold uppercase tracking-wide text-admin-ink-soft";

type TipoBadge = "porcentaje" | "monto_fijo" | "combo";

// Soft pastel bg + saturated text, one distinct pair per promotion type —
// same "soft bg / dark accent text" formula as the admin-green tokens.
// Reuses the Inicio (blue) and Catálogo (violet) sidebar accents from
// nav-items.ts for monto_fijo/combo so the palette stays consistent with
// the rest of the panel instead of inventing unrelated new hues.
const TIPO_BADGE_CLASSES: Record<TipoBadge, string> = {
  porcentaje: "bg-admin-green-soft text-admin-green-dark",
  monto_fijo: "bg-[#DBEAFE] text-[#3B82F6]",
  combo: "bg-[#EDE9FE] text-[#8B5CF6]",
};

const TIPO_BADGE_LABEL: Record<TipoBadge, string> = {
  porcentaje: "Porcentaje",
  monto_fijo: "Monto fijo",
  combo: "Combo",
};

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

  function tipoBadge(promo: Promotion): TipoBadge {
    if (promo.tipo === "COMBO") return "combo";
    const config = promo.config as DescuentoProductoConfig;
    return config.tipoDescuento === "porcentaje" ? "porcentaje" : "monto_fijo";
  }

  function describe(promo: Promotion) {
    if (promo.tipo === "DESCUENTO_PRODUCTO") {
      const config = promo.config as DescuentoProductoConfig;
      const monto = config.tipoDescuento === "porcentaje" ? `${config.valor}%` : `$${config.valor}`;
      return `${productName(config.productId)} — ${monto} de descuento`;
    }
    const config = promo.config as ComboConfig;
    return `${config.productIds.map(productName).join(" + ")} — $${config.precioCombo}`;
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
      <h2 className={SECTION_HEADER}>Promociones</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {promotions === null ? (
        <p className="text-sm text-admin-ink-soft">Cargando...</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {promotions.length === 0 && (
            <li>
              <Card className="text-sm text-admin-ink-soft">Aún no tienes promociones.</Card>
            </li>
          )}
          {promotions.map((promo) => (
            <li key={promo.id}>
              <Card padding={12} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge color={TIPO_BADGE_CLASSES[tipoBadge(promo)]}>{TIPO_BADGE_LABEL[tipoBadge(promo)]}</Badge>
                  <span
                    className={promo.activa ? "text-sm font-semibold text-admin-ink" : "text-sm font-semibold text-admin-ink/40"}
                  >
                    {describe(promo)}
                  </span>
                  {!promo.activa && (
                    <span className="rounded-full bg-admin-bg px-2 py-0.5 text-xs font-medium text-admin-ink-soft">
                      Inactiva
                    </span>
                  )}
                </div>
                {canWrite && (
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => handleToggleActiva(promo)}>
                      {promo.activa ? "Desactivar" : "Activar"}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleDelete(promo.id)}>
                      Eliminar
                    </Button>
                  </div>
                )}
              </Card>
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
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <p className="text-[17px] font-bold text-admin-ink">Nueva promoción</p>

        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as PromotionTipo)} className="admin-input">
            <option value="DESCUENTO_PRODUCTO">Descuento en un producto</option>
            <option value="COMBO">Combo de productos</option>
          </select>
        </label>

        {tipo === "DESCUENTO_PRODUCTO" ? (
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Producto
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className="admin-input">
                <option value="">Selecciona...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Tipo de descuento
              <select
                value={tipoDescuento}
                onChange={(e) => setTipoDescuento(e.target.value as "porcentaje" | "monto_fijo")}
                className="admin-input"
              >
                <option value="porcentaje">Porcentaje</option>
                <option value="monto_fijo">Monto fijo</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Valor
              <input
                type="number"
                min="0"
                step="0.01"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder={tipoDescuento === "porcentaje" ? "15" : "20.00"}
                className="admin-input"
              />
            </label>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Productos del combo (elige al menos 2)
              <div className="flex flex-col gap-1 rounded-[var(--radius-admin-control)] border border-admin-border p-2">
                {products.length === 0 && (
                  <span className="text-sm font-normal text-admin-ink-soft">No hay productos aún.</span>
                )}
                {products.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm font-normal text-admin-ink">
                    <input type="checkbox" checked={productIds.includes(p.id)} onChange={() => toggleProductId(p.id)} />
                    {p.nombre}
                  </label>
                ))}
              </div>
            </div>
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Precio del combo
              <input
                type="number"
                min="0"
                step="0.01"
                value={precioCombo}
                onChange={(e) => setPrecioCombo(e.target.value)}
                placeholder="199.00"
                className="admin-input"
              />
            </label>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" disabled={submitting} className="self-start">
          Crear promoción
        </Button>
      </form>
    </Card>
  );
}
