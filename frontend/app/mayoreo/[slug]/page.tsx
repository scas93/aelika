"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  ApiError,
  fetchPublicPedidoB2bCatalog,
  fetchPublicPedidoB2bTenant,
  type PublicPedidoB2bCatalog,
  type PublicPedidoB2bProduct,
  type PublicPedidoB2bTenantInfo,
} from "@/lib/api";
import InstruccionesModal from "./instrucciones-modal";
import ProductoDetalleModal from "./producto-detalle-modal";
import PedidoFlow, { type PedidoFlowScreen } from "./pedido-flow";

// mx-auto + max-w-md, igual que /tienda/[slug] — una sola columna angosta
// tipo "app de chat" en vez de un grid que se estira al ancho completo del
// viewport, que es lo que hacía que este storefront se sintiera como una
// app distinta aunque los colores ya coincidieran.
const WRAPPER = "mx-auto flex min-h-screen w-full max-w-md flex-col bg-mayoreo-bg font-mayoreo text-mayoreo-ink";
const PRODUCT_CARD =
  "flex flex-col gap-2 rounded-xl bg-mayoreo-card p-2 text-left shadow-sm transition hover:shadow-md";
// Mismo patrón de pills que las tabs de categoría en /tienda (page.tsx) —
// activa/inactiva, redondeada, con los tokens mayoreo-* en vez de black/white.
const TAB_ACTIVE = "shrink-0 rounded-full bg-mayoreo-button px-3.5 py-1.5 text-sm font-semibold text-white";
const TAB_INACTIVE =
  "shrink-0 rounded-full border border-mayoreo-border bg-mayoreo-card px-3.5 py-1.5 text-sm font-medium text-mayoreo-ink-soft";
const BACK_LINK = "text-sm text-mayoreo-ink-soft hover:text-mayoreo-ink";

// Mismo mensaje/estructura que el "Estamos cerrados" de checkout-modal.tsx en
// /tienda — ver el comentario junto a `cerrado` más abajo para el resto del
// mecanismo.
function AvisoCerrado({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl bg-mayoreo-card p-6 text-center shadow-sm">
      <h2 className="text-lg font-semibold text-mayoreo-ink">Estamos cerrados</h2>
      <p className="text-sm text-mayoreo-ink-soft">
        No podemos recibir pedidos en este momento. Vuelve a intentarlo cuando abramos.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg bg-mayoreo-button px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-95"
      >
        Cerrar
      </button>
    </div>
  );
}

// Catálogo → carrito → distribución semanal (+ resumen/confirmación, ver
// pedido-flow.tsx) — un flujo continuo de pantallas dentro de este mismo
// <main>, nunca modales apilados. InstruccionesModal y ProductoDetalleModal
// siguen siendo modales aparte, sin relación con este flujo de pantallas.
type Screen = "catalogo" | "carrito" | PedidoFlowScreen;

export default function MayoreoPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [tenant, setTenant] = useState<PublicPedidoB2bTenantInfo | null>(null);
  const [catalog, setCatalog] = useState<PublicPedidoB2bCatalog | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mostrarInstrucciones, setMostrarInstrucciones] = useState(true);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [productoDetalle, setProductoDetalle] = useState<PublicPedidoB2bProduct | null>(null);
  const [screen, setScreen] = useState<Screen>("catalogo");
  const [busqueda, setBusqueda] = useState("");
  const [tabActiva, setTabActiva] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [tenantData, catalogData] = await Promise.all([
          fetchPublicPedidoB2bTenant(slug),
          fetchPublicPedidoB2bCatalog(slug),
        ]);
        setTenant(tenantData);
        setCatalog(catalogData);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(err instanceof ApiError ? err.message : "No se pudo cargar la información del negocio");
        }
      }
    }
    load();
  }, [slug]);

  if (notFound) {
    return (
      <div className={`${WRAPPER} flex items-center justify-center p-6 text-center`}>
        <p className="text-mayoreo-ink-soft">No encontramos este negocio.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${WRAPPER} flex items-center justify-center p-6 text-center`}>
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (!tenant || !catalog) {
    return (
      <div className={`${WRAPPER} flex items-center justify-center p-6 text-center`}>
        <p className="text-mayoreo-ink-soft">Cargando...</p>
      </div>
    );
  }

  // Fuera de alcance de esta fase (ver CLAUDE.md) — el negocio cobra con
  // tarjeta al confirmar el pedido, y ese flujo de pago no está construido
  // en este storefront todavía. Placeholder temporal, sin intentar cobrar.
  if (tenant.pedidoB2bModoCobro === "AL_INICIO") {
    return (
      <div className={`${WRAPPER} flex items-center justify-center p-6 text-center`}>
        <div className="flex max-w-sm flex-col items-center gap-3">
          <h1 className="text-lg font-semibold">{tenant.nombre}</h1>
          <p className="text-mayoreo-ink-soft">
            Los pedidos con pago al confirmar aún no están disponibles en este storefront. Contacta directamente al
            negocio para levantar tu pedido de la semana.
          </p>
        </div>
      </div>
    );
  }

  const todosLosProductos = catalog.categories.flatMap((c) => c.products);

  const totalPiezas = Object.values(cart).reduce((sum, c) => sum + c, 0);
  const progreso = Math.min(100, Math.round((totalPiezas / tenant.pedidoB2bMinimoPiezas) * 100));

  function actualizarCantidad(productId: string, cantidad: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (cantidad <= 0) {
        delete next[productId];
      } else {
        next[productId] = cantidad;
      }
      return next;
    });
    setProductoDetalle(null);
  }

  // Igual que actualizarCantidad, pero por delta (+1/-1) en vez de un valor
  // absoluto — lo que necesita el control tipo pill del carrito, a
  // diferencia del modal de detalle que siempre fija una cantidad exacta.
  function cambiarCantidadCarrito(productId: string, delta: number) {
    setCart((prev) => {
      const next = { ...prev };
      const nueva = (next[productId] ?? 0) + delta;
      if (nueva <= 0) {
        delete next[productId];
      } else {
        next[productId] = nueva;
      }
      return next;
    });
  }

  // Mismo mecanismo que /tienda (checkout-modal.tsx): "abierto" viene del
  // backend (Tenant.horarioAtencion, ver PublicPedidosB2bService.getTenantInfo)
  // y createPedido lo vuelve a revisar server-side — este flag es solo para
  // no dejar avanzar al cliente por adelantado. A diferencia de /tienda (que
  // gatea todo el modal de checkout desde el paso "cart"), aquí el catálogo y
  // el carrito ya no son un modal sino pantallas propias del flujo, así que
  // el aviso se muestra en el lugar de cada pantalla de checkout en vez de
  // reemplazar toda la página — pero el efecto es el mismo: no se puede
  // avanzar ni enviar un pedido mientras el negocio está cerrado.
  const cerrado = !tenant.abierto;

  const productIdsCarrito = Object.keys(cart).filter((id) => cart[id] > 0);
  const subtotalCarrito = productIdsCarrito.reduce((sum, id) => {
    const product = todosLosProductos.find((p) => p.id === id);
    return sum + (product ? Number(product.precio) * cart[id] : 0);
  }, 0);

  const hayProductosEnCarrito = productIdsCarrito.length > 0;

  const term = busqueda.trim().toLowerCase();
  const buscando = term.length > 0;
  const productosFiltrados = todosLosProductos.filter((p) => p.nombre.toLowerCase().includes(term));
  const categoriaActiva = catalog.categories.find((c) => c.id === tabActiva) ?? catalog.categories[0];

  function ProductoCard({ product }: { product: PublicPedidoB2bProduct }) {
    const cantidad = cart[product.id] ?? 0;
    const abrirDetalle = () => setProductoDetalle(product);

    // El botón "+" abre el mismo modal de detalle que ya abre el resto de la
    // tarjeta (nunca agrega directamente) — stopPropagation solo evita que el
    // click también burbujee al onClick de la tarjeta completa, no cambia qué
    // acción dispara.
    const botonAgregar = (
      <button
        type="button"
        aria-label="Agregar"
        onClick={(e) => {
          e.stopPropagation();
          abrirDetalle();
        }}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-mayoreo-border bg-mayoreo-card text-lg font-semibold leading-none text-mayoreo-ink shadow-md transition hover:bg-mayoreo-bg"
      >
        +
      </button>
    );

    return (
      // La tarjeta completa sigue abriendo el modal de detalle al hacer
      // click (mismo comportamiento de antes) — ahora es un <div> en vez de
      // <button> para poder anidar el botón "+" real sin un <button> dentro
      // de otro <button> (HTML inválido).
      <div
        role="button"
        tabIndex={0}
        onClick={abrirDetalle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            abrirDetalle();
          }
        }}
        className={PRODUCT_CARD}
      >
        {product.fotoUrl && (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- external, tenant-provided URLs */}
            <img src={product.fotoUrl} alt="" className="aspect-square w-full rounded-xl object-cover" />
            <div className="absolute -bottom-2 right-1">{botonAgregar}</div>
          </div>
        )}
        <span className="text-sm font-medium">{product.nombre}</span>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-mayoreo-accent">${Number(product.precio).toFixed(2)}</span>
          <div className="flex items-center gap-2">
            {cantidad > 0 && (
              <span className="rounded-full bg-mayoreo-accent px-2 py-0.5 text-xs font-semibold text-white">
                {cantidad}
              </span>
            )}
            {!product.fotoUrl && botonAgregar}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={WRAPPER}>
      {mostrarInstrucciones && (
        <InstruccionesModal
          minimoPiezas={tenant.pedidoB2bMinimoPiezas}
          onEntendido={() => setMostrarInstrucciones(false)}
        />
      )}

      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-mayoreo-border bg-mayoreo-card px-4">
        {tenant.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- external, tenant-provided URLs
          <img src={tenant.logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
        )}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">{tenant.nombre}</span>
          <span className="truncate text-xs text-mayoreo-ink-soft">Arma tu pedido de la semana</span>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pb-24 pt-4">
        {screen === "catalogo" && (
          <>
            <h1 className="text-xl font-bold">Hola, ¿qué necesitas hoy?</h1>

            <div className="flex flex-col gap-1.5 rounded-xl bg-mayoreo-card p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-medium text-mayoreo-ink-soft">
                <span>
                  {totalPiezas} / {tenant.pedidoB2bMinimoPiezas} piezas
                </span>
                {totalPiezas >= tenant.pedidoB2bMinimoPiezas && (
                  <span className="font-semibold text-emerald-600">Mínimo alcanzado</span>
                )}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-mayoreo-bg">
                <div className="h-full bg-mayoreo-accent transition-all" style={{ width: `${progreso}%` }} />
              </div>
            </div>

            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Busca en el catálogo..."
              className="mayoreo-input search-input"
            />

            {buscando ? (
              <section className="flex flex-col gap-3">
                {productosFiltrados.length === 0 ? (
                  <p className="text-sm text-mayoreo-ink-soft">No encontramos nada para &ldquo;{busqueda}&rdquo;.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {productosFiltrados.map((product) => (
                      <ProductoCard key={product.id} product={product} />
                    ))}
                  </div>
                )}
              </section>
            ) : (
              categoriaActiva && (
                <>
                  <nav className="sticky top-16 z-20 -mx-4 flex gap-2 overflow-x-auto bg-mayoreo-bg px-4 py-2">
                    {catalog.categories.map((category) => (
                      <button
                        key={category.id}
                        onClick={() => setTabActiva(category.id)}
                        className={category.id === categoriaActiva.id ? TAB_ACTIVE : TAB_INACTIVE}
                      >
                        {category.nombre}
                      </button>
                    ))}
                  </nav>

                  <section className="flex flex-col gap-3">
                    <h2 className="text-sm font-semibold text-mayoreo-ink-soft">{categoriaActiva.nombre}</h2>
                    {categoriaActiva.products.length === 0 ? (
                      <p className="text-sm text-mayoreo-ink-soft">No hay productos disponibles.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        {categoriaActiva.products.map((product) => (
                          <ProductoCard key={product.id} product={product} />
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )
            )}
          </>
        )}

        {screen === "carrito" && cerrado && <AvisoCerrado onClose={() => setScreen("catalogo")} />}

        {screen === "carrito" && !cerrado && (
          <>
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold">Tu carrito</h1>
              <button type="button" onClick={() => setScreen("catalogo")} className={BACK_LINK}>
                Atrás
              </button>
            </div>

            {productIdsCarrito.length === 0 ? (
              <p className="text-sm text-mayoreo-ink-soft">Aún no has agregado productos.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {productIdsCarrito.map((id) => {
                  const product = todosLosProductos.find((p) => p.id === id);
                  if (!product) return null;
                  const cantidad = cart[id];
                  return (
                    <li key={id} className="flex items-center gap-3 rounded-xl bg-mayoreo-card p-3 shadow-sm">
                      {product.fotoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element -- external, tenant-provided URLs
                        <img src={product.fotoUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                      )}
                      <div className="flex flex-1 flex-col">
                        <span className="text-sm font-medium">{product.nombre}</span>
                        <span className="text-xs text-mayoreo-ink-soft">${Number(product.precio).toFixed(2)} c/u</span>
                      </div>
                      <div className="flex items-center gap-2 rounded-full bg-mayoreo-button px-1.5 py-1 text-white">
                        <button
                          type="button"
                          onClick={() => cambiarCantidadCarrito(id, -1)}
                          aria-label="Quitar uno"
                          className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium"
                        >
                          −
                        </button>
                        <span className="w-5 text-center text-sm font-semibold">{cantidad}</span>
                        <button
                          type="button"
                          onClick={() => cambiarCantidadCarrito(id, 1)}
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
            )}

            <div className="flex items-center justify-between border-t border-mayoreo-border pt-3 text-sm font-semibold">
              <span>Subtotal</span>
              <span>${subtotalCarrito.toFixed(2)}</span>
            </div>

            <button
              type="button"
              onClick={() => setScreen("distribucion")}
              disabled={productIdsCarrito.length === 0}
              className="rounded-lg bg-mayoreo-button px-4 py-3 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continuar ({totalPiezas} pieza{totalPiezas === 1 ? "" : "s"})
            </button>
          </>
        )}

        {(screen === "distribucion" || screen === "resumen") && cerrado && (
          <AvisoCerrado onClose={() => setScreen("catalogo")} />
        )}

        {((screen === "distribucion" || screen === "resumen") && !cerrado) || screen === "confirmacion" ? (
          <PedidoFlow
            slug={slug}
            catalog={catalog}
            cart={cart}
            minimoPiezas={tenant.pedidoB2bMinimoPiezas}
            facturacionModo={tenant.facturacionModo}
            screen={screen}
            onScreenChange={setScreen}
            onBackToCarrito={() => setScreen("carrito")}
            onFinish={() => {
              setCart({});
              setScreen("catalogo");
            }}
          />
        ) : null}
      </main>

      {screen === "catalogo" && hayProductosEnCarrito && (
        <button
          type="button"
          onClick={() => setScreen("carrito")}
          className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-fit items-center gap-4 rounded-full bg-mayoreo-button px-6 py-3.5 text-sm font-semibold text-white shadow-lg"
        >
          <span>
            {totalPiezas} pieza{totalPiezas === 1 ? "" : "s"}
          </span>
          <span>Continuar</span>
        </button>
      )}

      {productoDetalle && (
        <ProductoDetalleModal
          product={productoDetalle}
          cantidadInicial={cart[productoDetalle.id] ?? 0}
          onConfirm={(cantidad) => actualizarCantidad(productoDetalle.id, cantidad)}
          onClose={() => setProductoDetalle(null)}
        />
      )}
    </div>
  );
}
