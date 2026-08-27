"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ApiError,
  fetchPublicCatalog,
  fetchPublicTenant,
  type ComboConfig,
  type DescuentoProductoConfig,
  type PublicCatalog,
  type PublicProduct,
  type PublicPromotion,
  type PublicTenantInfo,
} from "@/lib/api";
import CheckoutModal, { type CartItem, type CartItemModifier, type ResumenItem } from "./checkout-modal";
import ProductModifiersModal from "./product-modifiers-modal";

// Two lines are "the same" (mergeable by incrementing cantidad) when they're
// the same product AND carry the exact same set of selected modifiers,
// regardless of order. A product with no modifierGroups is always called
// with modifiers = [] (there's nothing to select), so this single rule
// already covers both cases from the prompt — no separate branch needed.
function mismaSeleccion(a: CartItemModifier[], b: CartItemModifier[]) {
  if (a.length !== b.length) return false;
  const idsA = new Set(a.map((m) => m.modifierOptionId));
  return b.every((m) => idsA.has(m.modifierOptionId));
}

function precioConDescuento(product: PublicProduct, promotions: PublicPromotion[]) {
  const precioOriginal = Number(product.precio);
  const promo = promotions.find(
    (p) => p.tipo === "DESCUENTO_PRODUCTO" && (p.config as DescuentoProductoConfig).productId === product.id,
  );
  if (!promo) {
    return { precioFinal: precioOriginal, precioOriginal, promo: null as PublicPromotion | null };
  }

  const config = promo.config as DescuentoProductoConfig;
  const precioFinal =
    config.tipoDescuento === "porcentaje"
      ? precioOriginal * (1 - config.valor / 100)
      : Math.max(0, precioOriginal - config.valor);

  return { precioFinal, precioOriginal, promo };
}

function nombreProducto(catalog: PublicCatalog, productId: string) {
  for (const category of catalog.categories) {
    const product = category.products.find((p) => p.id === productId);
    if (product) return product.nombre;
  }
  return "(producto no disponible)";
}

export default function TiendaPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [tenant, setTenant] = useState<PublicTenantInfo | null>(null);
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [tabActiva, setTabActiva] = useState("");
  const [modifierTarget, setModifierTarget] = useState<{ product: PublicProduct; precioUnitario: number } | null>(
    null,
  );

  useEffect(() => {
    async function load() {
      try {
        const [tenantData, catalogData] = await Promise.all([fetchPublicTenant(slug), fetchPublicCatalog(slug)]);
        setTenant(tenantData);
        setCatalog(catalogData);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(err instanceof ApiError ? err.message : "No se pudo cargar la tienda");
        }
      }
    }
    load();
  }, [slug]);

  function addToCart(
    productId: string,
    nombre: string,
    precioUnitario: number,
    modifiers: CartItemModifier[] = [],
    cantidad = 1,
  ) {
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === productId && mismaSeleccion(item.modifiers, modifiers));
      if (existing) {
        return prev.map((item) => (item.id === existing.id ? { ...item, cantidad: item.cantidad + cantidad } : item));
      }
      return [...prev, { id: crypto.randomUUID(), productId, nombre, precioUnitario, cantidad, modifiers }];
    });
  }

  // Keyed by CartItem.id (the line), not productId — see CheckoutModal's
  // onChangeQty prop for why productId alone stopped being enough once a
  // product can have multiple lines with different modifiers.
  function changeQty(id: string, delta: number) {
    setCart((prev) =>
      prev.map((item) => (item.id === id ? { ...item, cantidad: item.cantidad + delta } : item)).filter((item) => item.cantidad > 0),
    );
  }

  function addCombo(config: ComboConfig) {
    if (!catalog) return;
    setCart((prev) => {
      let next = prev;
      for (const productId of config.productIds) {
        const nombre = nombreProducto(catalog, productId);
        const category = catalog.categories.find((c) => c.products.some((p) => p.id === productId));
        const product = category?.products.find((p) => p.id === productId);
        const precioUnitario = product ? Number(product.precio) : 0;
        const existing = next.find((item) => item.productId === productId && item.modifiers.length === 0);
        next = existing
          ? next.map((item) => (item.id === existing.id ? { ...item, cantidad: item.cantidad + 1 } : item))
          : [...next, { id: crypto.randomUUID(), productId, nombre, precioUnitario, cantidad: 1, modifiers: [] }];
      }
      return next;
    });
  }

  /**
   * Shared onAdd/onIncrement/onDecrement/cantidad wiring for a ProductoCard.
   * A product with modifierGroups always shows the plain "+" (never the
   * inline -/+ pill, cantidad forced to 0 here) because once it can have
   * multiple cart lines with different modifier selections, a single pill on
   * the grid card can't unambiguously represent "the" quantity for that
   * product — adjusting a specific line's quantity happens in the cart step
   * instead, where each line is addressed by its own id.
   */
  function cardProps(product: PublicProduct, precioFinal: number) {
    const tieneModificadores = product.modifierGroups.length > 0;
    const cartItem = cart.find((i) => i.productId === product.id);
    return {
      cantidad: tieneModificadores ? 0 : (cartItem?.cantidad ?? 0),
      onAdd: () => {
        if (tieneModificadores) {
          setModifierTarget({ product, precioUnitario: precioFinal });
        } else {
          addToCart(product.id, product.nombre, precioFinal);
        }
      },
      onIncrement: () => cartItem && changeQty(cartItem.id, 1),
      onDecrement: () => cartItem && changeQty(cartItem.id, -1),
    };
  }

  const totalItems = cart.reduce((sum, item) => sum + item.cantidad, 0);
  // Includes each line's modifiers extra — same formula as the backend
  // (subtotal + modifiersExtra - descuento), so this estimate and the
  // eventual real total from createOrder don't diverge once modifiers exist.
  const total = cart.reduce((sum, item) => {
    const extraPorUnidad = item.modifiers.reduce((s, m) => s + m.precioAdicional, 0);
    return sum + item.cantidad * (item.precioUnitario + extraPorUnidad);
  }, 0);

  if (notFound) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-center">
        <p className="text-black/60 dark:text-white/60">No encontramos este negocio.</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-center">
        <p className="text-red-600">{error}</p>
      </main>
    );
  }

  if (!tenant || !catalog) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-sm text-black/60 dark:text-white/60">
        Cargando...
      </main>
    );
  }

  const combos = catalog.promotions.filter((p) => p.tipo === "COMBO");

  const term = busqueda.trim().toLowerCase();
  const buscando = term.length > 0;
  const todosLosProductos = catalog.categories.flatMap((c) => c.products);
  const productosFiltrados = todosLosProductos.filter((p) => p.nombre.toLowerCase().includes(term));
  const combosFiltrados = combos.filter((combo) =>
    (combo.config as ComboConfig).productIds.some((id) => nombreProducto(catalog, id).toLowerCase().includes(term)),
  );
  const categoriaActiva = catalog.categories.find((c) => c.id === tabActiva) ?? catalog.categories[0];

  const resumenItems: ResumenItem[] = cart.map((item) => {
    const producto = todosLosProductos.find((p) => p.id === item.productId);
    const precioOriginal = producto ? Number(producto.precio) : item.precioUnitario;
    return { ...item, precioOriginal };
  });

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-chat-bg font-chat dark:bg-chat-bg-dark">
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-black/10 bg-white px-4 dark:border-white/10 dark:bg-chat-card-dark">
        <button
          onClick={() => window.history.back()}
          aria-label="Regresar"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg text-black/60 transition hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10"
        >
          ←
        </button>
        {tenant.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- external, tenant-provided URLs
          <img src={tenant.logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
        )}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">{tenant.nombre}</span>
          <span className="truncate text-xs text-black/40 dark:text-white/40">pide.aelika.com/{slug}</span>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pb-24 pt-4">
        <h1 className="text-xl font-bold">Hola, ¿qué necesitas hoy?</h1>

        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Busca en el menú..."
          className="input search-input"
        />

        {!buscando && combos.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Promociones</h2>
            <PromocionesCarousel
              combos={combos}
              catalog={catalog}
              onAdd={(config) => addCombo(config)}
            />
            <p className="text-xs text-black/50 dark:text-white/50">
              El precio de la promoción se ajusta al finalizar tu pedido.
            </p>
          </section>
        )}

        {buscando ? (
          <section className="flex flex-col gap-2">
            {combosFiltrados.length === 0 && productosFiltrados.length === 0 ? (
              <p className="text-sm text-black/60 dark:text-white/60">No encontramos nada para &ldquo;{busqueda}&rdquo;.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {combosFiltrados.map((combo) => (
                  <ComboRow
                    key={combo.id}
                    config={combo.config as ComboConfig}
                    catalog={catalog}
                    onAdd={() => addCombo(combo.config as ComboConfig)}
                  />
                ))}
                {productosFiltrados.map((product) => {
                  const { precioFinal, precioOriginal, promo } = precioConDescuento(product, catalog.promotions);
                  const { cantidad, onAdd, onIncrement, onDecrement } = cardProps(product, precioFinal);
                  return (
                    <ProductoCard
                      key={product.id}
                      product={product}
                      precioFinal={precioFinal}
                      precioOriginal={precioOriginal}
                      promo={promo}
                      cantidad={cantidad}
                      layout="list"
                      onAdd={onAdd}
                      onIncrement={onIncrement}
                      onDecrement={onDecrement}
                    />
                  );
                })}
              </ul>
            )}
          </section>
        ) : categoriaActiva ? (
          <>
            <nav className="sticky top-16 z-20 -mx-4 flex gap-2 overflow-x-auto bg-chat-bg px-4 py-2 dark:bg-chat-bg-dark">
              {catalog.categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setTabActiva(category.id)}
                  className={
                    category.id === categoriaActiva.id
                      ? "shrink-0 rounded-full bg-black px-3.5 py-1.5 text-sm font-semibold text-white dark:bg-white dark:text-black"
                      : "shrink-0 rounded-full border border-black/10 bg-black/5 px-3.5 py-1.5 text-sm font-medium text-black/60 dark:border-white/10 dark:bg-white/10 dark:text-white/60"
                  }
                >
                  {category.nombre}
                </button>
              ))}
            </nav>

            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">{categoriaActiva.nombre}</h2>
              {categoriaActiva.products.length === 0 ? (
                <p className="text-sm text-black/60 dark:text-white/60">No hay productos disponibles.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-3">
                  {categoriaActiva.products.map((product) => {
                    const { precioFinal, precioOriginal, promo } = precioConDescuento(product, catalog.promotions);
                    const { cantidad, onAdd, onIncrement, onDecrement } = cardProps(product, precioFinal);
                    return (
                      <ProductoCard
                        key={product.id}
                        product={product}
                        precioFinal={precioFinal}
                        precioOriginal={precioOriginal}
                        promo={promo}
                        cantidad={cantidad}
                        layout="grid"
                        onAdd={onAdd}
                        onIncrement={onIncrement}
                        onDecrement={onDecrement}
                      />
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        ) : (
          // catalog.categories vacío (sin categorías activas, o ninguna con
          // productos) — sin este caso categoriaActiva queda undefined y la
          // pantalla se quedaba en blanco debajo del buscador, sin ningún
          // indicio de qué pasó.
          <p className="text-sm text-black/60 dark:text-white/60">
            Este negocio todavía no tiene productos disponibles.
          </p>
        )}
      </main>

      {totalItems > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-fit items-center gap-4 rounded-full bg-black px-6 py-3.5 text-sm font-semibold text-white shadow-lg dark:bg-white dark:text-black"
        >
          <span>
            {totalItems} artículo{totalItems === 1 ? "" : "s"}
          </span>
          <span>${total.toFixed(2)}</span>
        </button>
      )}

      {cartOpen && (
        <CheckoutModal
          slug={slug}
          items={cart}
          total={total}
          resumenItems={resumenItems}
          abierto={tenant.abierto}
          horario={tenant.horarioAtencion}
          facturacionModo={tenant.facturacionModo}
          aceptaTarjeta={tenant.aceptaTarjeta}
          onChangeQty={changeQty}
          onClose={() => setCartOpen(false)}
          onSuccess={() => setCart([])}
        />
      )}

      {modifierTarget && (
        <ProductModifiersModal
          product={modifierTarget.product}
          precioUnitario={modifierTarget.precioUnitario}
          onClose={() => setModifierTarget(null)}
          onConfirm={(modifiers, cantidad) => {
            addToCart(
              modifierTarget.product.id,
              modifierTarget.product.nombre,
              modifierTarget.precioUnitario,
              modifiers,
              cantidad,
            );
            setModifierTarget(null);
          }}
        />
      )}
    </div>
  );
}

function ComboRow({ config, catalog, onAdd }: { config: ComboConfig; catalog: PublicCatalog; onAdd: () => void }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 shadow-sm dark:bg-chat-card-dark">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">
          {config.productIds.map((id) => nombreProducto(catalog, id)).join(" + ")}
        </span>
        <span className="text-sm font-semibold">${config.precioCombo}</span>
      </div>
      <button
        onClick={onAdd}
        className="shrink-0 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white transition hover:brightness-95 dark:bg-white dark:text-black"
      >
        Agregar promoción
      </button>
    </li>
  );
}

// Horizontal carousel of active promotions: native overflow-x scroll with
// snap gives free touch-swipe on mobile, and the prev/next buttons cover
// mouse-only desktop use — both drive the same scrollLeft, no separate state.
function PromocionesCarousel({
  combos,
  catalog,
  onAdd,
}: {
  combos: PublicPromotion[];
  catalog: PublicCatalog;
  onAdd: (config: ComboConfig) => void;
}) {
  const scrollRef = useRef<HTMLUListElement>(null);

  function scroll(direction: 1 | -1) {
    const el = scrollRef.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const amount = card ? card.getBoundingClientRect().width + 12 : el.clientWidth * 0.8;
    el.scrollBy({ left: direction * amount, behavior: "smooth" });
  }

  return (
    <div className="relative">
      <ul
        ref={scrollRef}
        className={`flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          combos.length === 1 ? "justify-center" : ""
        }`}
      >
        {combos.map((combo) => (
          <PromocionCard
            key={combo.id}
            config={combo.config as ComboConfig}
            catalog={catalog}
            onAdd={() => onAdd(combo.config as ComboConfig)}
          />
        ))}
      </ul>
      {combos.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => scroll(-1)}
            aria-label="Ver promoción anterior"
            className="absolute -left-1 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white text-sm font-semibold text-black shadow-md dark:bg-chat-card-dark dark:text-white"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => scroll(1)}
            aria-label="Ver siguiente promoción"
            className="absolute -right-1 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white text-sm font-semibold text-black shadow-md dark:bg-chat-card-dark dark:text-white"
          >
            ›
          </button>
        </>
      )}
    </div>
  );
}

function PromocionCard({ config, catalog, onAdd }: { config: ComboConfig; catalog: PublicCatalog; onAdd: () => void }) {
  return (
    <li className="flex w-[85%] shrink-0 snap-start flex-col justify-between gap-2 rounded-xl bg-white p-3 shadow-sm dark:bg-chat-card-dark">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">
          {config.productIds.map((id) => nombreProducto(catalog, id)).join(" + ")}
        </span>
        <span className="text-sm font-semibold">${config.precioCombo}</span>
      </div>
      <button
        onClick={onAdd}
        className="w-full shrink-0 rounded-lg bg-black px-3 py-2 text-sm font-medium text-white transition hover:brightness-95 dark:bg-white dark:text-black"
      >
        Agregar
      </button>
    </li>
  );
}

function QtyControl({
  cantidad,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  cantidad: number;
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  if (cantidad === 0) {
    return (
      <button
        onClick={onAdd}
        aria-label="Agregar"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white text-lg font-semibold leading-none text-black shadow-md transition hover:bg-black/5"
      >
        +
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-black px-1.5 py-1 text-white shadow-sm dark:bg-white dark:text-black">
      <button
        onClick={onDecrement}
        aria-label="Quitar uno"
        className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium"
      >
        −
      </button>
      <span className="w-4 text-center text-sm font-semibold">{cantidad}</span>
      <button
        onClick={onIncrement}
        aria-label="Agregar uno"
        className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium"
      >
        +
      </button>
    </div>
  );
}

function ProductoCard({
  product,
  precioFinal,
  precioOriginal,
  promo,
  cantidad,
  layout,
  onAdd,
  onIncrement,
  onDecrement,
}: {
  product: PublicProduct;
  precioFinal: number;
  precioOriginal: number;
  promo: PublicPromotion | null;
  cantidad: number;
  layout: "grid" | "list";
  onAdd: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const sinExistencia = !product.disponible;

  const media = product.fotoUrl ? (
    <div
      className={`relative overflow-hidden rounded-xl ${layout === "grid" ? "aspect-square w-full" : "h-16 w-16 shrink-0"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- external, tenant-provided URLs */}
      <img src={product.fotoUrl} alt="" className="h-full w-full object-cover" />
    </div>
  ) : null;

  const descuentoConfig = promo && (promo.config as DescuentoProductoConfig);
  const descuentoTexto = descuentoConfig
    ? descuentoConfig.tipoDescuento === "porcentaje"
      ? `-${descuentoConfig.valor}% off`
      : `-$${descuentoConfig.valor} off`
    : null;

  const precioTag = (
    <div className="flex items-center gap-1.5">
      {promo ? (
        <>
          <span className="text-xs text-black/40 line-through dark:text-white/40">${precioOriginal.toFixed(2)}</span>
          <span className="text-sm font-bold text-red-600 dark:text-red-400">${precioFinal.toFixed(2)}</span>
        </>
      ) : (
        <span className="text-sm font-semibold">${precioOriginal.toFixed(2)}</span>
      )}
    </div>
  );

  const descuentoBadge = descuentoTexto && (
    <span className="w-fit rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white dark:bg-red-500">
      {descuentoTexto}
    </span>
  );

  const control = !sinExistencia && (
    <QtyControl cantidad={cantidad} onAdd={onAdd} onIncrement={onIncrement} onDecrement={onDecrement} />
  );

  if (layout === "list") {
    return (
      <li
        className={`flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm dark:bg-chat-card-dark ${sinExistencia ? "opacity-50" : ""}`}
      >
        {media}
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{product.nombre}</span>
          {product.descripcion && (
            <span className="text-xs text-black/50 dark:text-white/50">{product.descripcion}</span>
          )}
          {precioTag}
          {descuentoBadge}
        </div>
        {control}
      </li>
    );
  }

  return (
    <li
      className={`flex flex-col gap-2 rounded-xl bg-white p-2 shadow-sm dark:bg-chat-card-dark ${sinExistencia ? "opacity-50" : ""}`}
    >
      {media && (
        <div className="relative">
          {media}
          {control && <div className="absolute -bottom-2 right-1">{control}</div>}
        </div>
      )}
      <div className="flex flex-col gap-0.5 px-0.5 pb-1">
        <span className="text-sm font-medium">{product.nombre}</span>
        {precioTag}
        {descuentoBadge}
        {!media && control && <div className="flex justify-end">{control}</div>}
      </div>
    </li>
  );
}
