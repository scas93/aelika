"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  ApiError,
  DIAS_SEMANA,
  fetchPublicCatalog,
  fetchPublicTenant,
  type ComboConfig,
  type DescuentoProductoConfig,
  type DiaSemana,
  type HorarioSemana,
  type PublicCatalog,
  type PublicProduct,
  type PublicPromotion,
  type PublicTenantInfo,
} from "@/lib/api";
import CheckoutModal, { type CartItem, type ResumenItem } from "./checkout-modal";

const DIA_LABELS: Record<DiaSemana, string> = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miércoles",
  jueves: "Jueves",
  viernes: "Viernes",
  sabado: "Sábado",
  domingo: "Domingo",
};

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

  function addToCart(productId: string, nombre: string, precioUnitario: number) {
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === productId);
      if (existing) {
        return prev.map((item) => (item.productId === productId ? { ...item, cantidad: item.cantidad + 1 } : item));
      }
      return [...prev, { productId, nombre, precioUnitario, cantidad: 1 }];
    });
  }

  function changeQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((item) => (item.productId === productId ? { ...item, cantidad: item.cantidad + delta } : item))
        .filter((item) => item.cantidad > 0),
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
        const existing = next.find((item) => item.productId === productId);
        next = existing
          ? next.map((item) => (item.productId === productId ? { ...item, cantidad: item.cantidad + 1 } : item))
          : [...next, { productId, nombre, precioUnitario, cantidad: 1 }];
      }
      return next;
    });
  }

  const totalItems = cart.reduce((sum, item) => sum + item.cantidad, 0);
  const total = cart.reduce((sum, item) => sum + item.cantidad * item.precioUnitario, 0);

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

        <div className="flex flex-col gap-2 rounded-xl bg-white p-3 shadow-sm dark:bg-chat-card-dark">
          {tenant.ubicacion && <p className="text-sm text-black/60 dark:text-white/60">{tenant.ubicacion}</p>}
          {!tenant.abierto && (
            <span className="w-fit rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
              Cerrado en este momento
            </span>
          )}
          <HorarioList horario={tenant.horarioAtencion} />
        </div>

        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Busca en el menú..."
          className="input search-input"
        />

        {!buscando && combos.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Combos</h2>
            <ul className="flex flex-col gap-2">
              {combos.map((combo) => (
                <ComboRow
                  key={combo.id}
                  config={combo.config as ComboConfig}
                  catalog={catalog}
                  onAdd={() => addCombo(combo.config as ComboConfig)}
                />
              ))}
            </ul>
            <p className="text-xs text-black/50 dark:text-white/50">
              El precio de combo se ajusta al finalizar tu pedido.
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
                  const cantidad = cart.find((i) => i.productId === product.id)?.cantidad ?? 0;
                  return (
                    <ProductoCard
                      key={product.id}
                      product={product}
                      precioFinal={precioFinal}
                      precioOriginal={precioOriginal}
                      promo={promo}
                      cantidad={cantidad}
                      layout="list"
                      onAdd={() => addToCart(product.id, product.nombre, precioFinal)}
                      onIncrement={() => changeQty(product.id, 1)}
                      onDecrement={() => changeQty(product.id, -1)}
                    />
                  );
                })}
              </ul>
            )}
          </section>
        ) : (
          categoriaActiva && (
            <>
              <nav className="sticky top-16 z-20 -mx-4 flex gap-1 overflow-x-auto border-b border-black/10 bg-chat-bg px-4 py-2 dark:border-white/10 dark:bg-chat-bg-dark">
                {catalog.categories.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => setTabActiva(category.id)}
                    className={
                      category.id === categoriaActiva.id
                        ? "shrink-0 border-b-2 border-black px-3 py-2 text-sm font-semibold text-black dark:border-white dark:text-white"
                        : "shrink-0 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-black/40 dark:text-white/40"
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
                      const cantidad = cart.find((i) => i.productId === product.id)?.cantidad ?? 0;
                      return (
                        <ProductoCard
                          key={product.id}
                          product={product}
                          precioFinal={precioFinal}
                          precioOriginal={precioOriginal}
                          promo={promo}
                          cantidad={cantidad}
                          layout="grid"
                          onAdd={() => addToCart(product.id, product.nombre, precioFinal)}
                          onIncrement={() => changeQty(product.id, 1)}
                          onDecrement={() => changeQty(product.id, -1)}
                        />
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          )
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
          onChangeQty={changeQty}
          onClose={() => setCartOpen(false)}
          onSuccess={() => setCart([])}
        />
      )}
    </div>
  );
}

function HorarioList({ horario }: { horario: HorarioSemana | null }) {
  if (!horario) return null;

  return (
    <details className="text-sm text-black/60 dark:text-white/60">
      <summary className="cursor-pointer font-medium">Horario</summary>
      <ul className="mt-1 flex flex-col gap-0.5">
        {DIAS_SEMANA.map((dia) => {
          const info = horario[dia];
          return (
            <li key={dia} className="flex justify-between gap-4">
              <span>{DIA_LABELS[dia]}</span>
              <span>{info.abierto && info.apertura && info.cierre ? `${info.apertura} – ${info.cierre}` : "Cerrado"}</span>
            </li>
          );
        })}
      </ul>
    </details>
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
        Agregar combo
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

  const badgePill = sinExistencia && (
    <span className="w-fit rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">
      Sin existencia
    </span>
  );

  const media = product.fotoUrl ? (
    <div
      className={`relative overflow-hidden rounded-xl ${layout === "grid" ? "aspect-square w-full" : "h-16 w-16 shrink-0"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- external, tenant-provided URLs */}
      <img
        src={product.fotoUrl}
        alt=""
        className={`h-full w-full object-cover ${sinExistencia ? "opacity-60" : ""}`}
      />
      {badgePill && <div className="absolute left-1 top-1">{badgePill}</div>}
    </div>
  ) : (
    // Sin fotoUrl, layout "grid" necesita igual un contenedor con el tamaño
    // real de la imagen (aspect-square) para que el pill de cantidad, que se
    // posiciona absolute respecto a este bloque, tenga de dónde anclarse en
    // la esquina — sin esto, el contenedor colapsa a altura 0 y el pill
    // termina flotando fuera de la card. En "list" el control no es
    // absolute sobre media, así que no hace falta placeholder ahí.
    layout === "grid" && <div className="aspect-square w-full rounded-xl bg-black/5 dark:bg-white/10" />
  );

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
      <li className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm dark:bg-chat-card-dark">
        {media}
        <div className="flex flex-1 flex-col gap-0.5">
          {!product.fotoUrl && badgePill}
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
    <li className="flex flex-col gap-2 rounded-xl bg-white p-2 shadow-sm dark:bg-chat-card-dark">
      <div className="relative">
        {media}
        {control && <div className="absolute -bottom-2 right-1">{control}</div>}
      </div>
      <div className="flex flex-col gap-0.5 px-0.5 pb-1">
        {!product.fotoUrl && badgePill}
        <span className="text-sm font-medium">{product.nombre}</span>
        {precioTag}
        {descuentoBadge}
      </div>
    </li>
  );
}
