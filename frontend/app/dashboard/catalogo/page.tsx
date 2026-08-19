"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  createCategory,
  createProduct,
  deleteCategory,
  fetchCategories,
  fetchProducts,
  updateCategory,
  updateProduct,
  type Category,
  type Product,
} from "@/lib/api";
import PromotionsSection from "./promotions-section";

type Tab = "catalogo" | "promociones";

const CARD = "rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]";
const BTN_PRIMARY =
  "rounded-lg bg-admin-green px-4 py-2 text-sm font-bold text-white transition hover:bg-admin-green-dark disabled:cursor-not-allowed disabled:opacity-40";
const BTN_SECONDARY =
  "rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-bold text-admin-ink/70 transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-40";
const BTN_DANGER =
  "rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-black/10 disabled:text-admin-ink/40 disabled:hover:bg-transparent";

export default function CatalogoPage() {
  const { user, token } = useSession();
  const canWrite = user.rol === "GERENTE" || user.rol === "DUENO";
  const [tab, setTab] = useState<Tab>("catalogo");

  const [categories, setCategories] = useState<Category[] | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function loadCategories() {
    try {
      const data = await fetchCategories(token);
      setCategories(data);
      setSelectedCategoryId((current) => current ?? data[0]?.id ?? null);
    } catch (err) {
      setCategoriesError(err instanceof ApiError ? err.message : "No se pudieron cargar las categorías");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateCategory(nombre: string) {
    await createCategory(token, { nombre });
    await loadCategories();
  }

  async function handleToggleActiva(category: Category) {
    setCategories((prev) =>
      prev ? prev.map((c) => (c.id === category.id ? { ...c, activa: !category.activa } : c)) : prev,
    );
    await updateCategory(token, category.id, { activa: !category.activa });
  }

  async function handleReorder(index: number, direction: -1 | 1) {
    if (!categories) return;
    const target = index + direction;
    if (target < 0 || target >= categories.length) return;

    const a = categories[index];
    const b = categories[target];

    const reordered = [...categories];
    reordered[index] = { ...a, orden: b.orden };
    reordered[target] = { ...b, orden: a.orden };
    reordered.sort((x, y) => x.orden - y.orden || x.nombre.localeCompare(y.nombre));
    setCategories(reordered);

    await Promise.all([
      updateCategory(token, a.id, { orden: b.orden }),
      updateCategory(token, b.id, { orden: a.orden }),
    ]);
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCategory(token, deleteTarget.id);
      const remaining = (categories ?? []).filter((c) => c.id !== deleteTarget.id);
      setCategories(remaining);
      if (selectedCategoryId === deleteTarget.id) {
        setSelectedCategoryId(remaining[0]?.id ?? null);
      }
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "No se pudo eliminar la categoría");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2">
        <TabButton active={tab === "catalogo"} onClick={() => setTab("catalogo")}>
          Categorías y productos
        </TabButton>
        <TabButton active={tab === "promociones"} onClick={() => setTab("promociones")}>
          Promociones
        </TabButton>
      </div>

      {tab === "promociones" ? (
        <PromotionsSection token={token} canWrite={canWrite} />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-extrabold uppercase tracking-wide text-admin-ink/55">Categorías</h2>
            {categoriesError && <p className="text-sm text-red-600">{categoriesError}</p>}
            {categories === null ? (
              <p className="text-sm text-admin-ink/55">Cargando...</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {categories.length === 0 && (
                  <li className={`${CARD} p-4 text-sm text-admin-ink/55`}>Aún no tienes categorías.</li>
                )}
                {categories.map((category, index) => (
                  <li
                    key={category.id}
                    className={`${CARD} flex items-center justify-between gap-3 p-3 ${
                      selectedCategoryId === category.id ? "ring-2 ring-admin-green/40" : ""
                    }`}
                  >
                    <button
                      onClick={() => setSelectedCategoryId(category.id)}
                      className="flex flex-1 items-center gap-2 text-left text-sm"
                    >
                      <span className={category.activa ? "font-bold text-admin-ink" : "font-bold text-admin-ink/40"}>
                        {category.nombre}
                      </span>
                      {!category.activa && (
                        <span className="rounded-full bg-admin-bg px-2 py-0.5 text-xs font-medium text-admin-ink/55">
                          Inactiva
                        </span>
                      )}
                    </button>

                    {canWrite && (
                      <div className="flex items-center gap-1.5">
                        <IconButton label="Subir" disabled={index === 0} onClick={() => handleReorder(index, -1)}>
                          ↑
                        </IconButton>
                        <IconButton
                          label="Bajar"
                          disabled={index === categories.length - 1}
                          onClick={() => handleReorder(index, 1)}
                        >
                          ↓
                        </IconButton>
                        <button onClick={() => handleToggleActiva(category)} className={BTN_SECONDARY}>
                          {category.activa ? "Desactivar" : "Activar"}
                        </button>
                        <button
                          onClick={() => setDeleteTarget(category)}
                          disabled={category._count.products > 0}
                          title={category._count.products > 0 ? "Tiene productos" : undefined}
                          className={BTN_DANGER}
                        >
                          Eliminar
                        </button>
                        {category._count.products > 0 && (
                          <span className="text-xs text-admin-ink/40">Tiene productos</span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canWrite && <NewCategoryForm onCreate={handleCreateCategory} />}
          </section>

          {deleteTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="flex w-full max-w-sm flex-col gap-4 rounded-[14px] bg-white p-6 shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
                <h3 className="text-lg font-extrabold text-admin-ink">¿Eliminar la categoría {deleteTarget.nombre}?</h3>
                <p className="text-sm text-admin-ink/55">Esta acción no se puede deshacer.</p>
                {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={handleDeleteConfirm} disabled={deleting} className={BTN_PRIMARY}>
                    {deleting ? "Eliminando..." : "Eliminar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteTarget(null);
                      setDeleteError(null);
                    }}
                    disabled={deleting}
                    className={BTN_SECONDARY}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          )}

          {selectedCategoryId && (
            <ProductsSection key={selectedCategoryId} token={token} categoryId={selectedCategoryId} canWrite={canWrite} />
          )}
        </>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "rounded-lg bg-admin-green px-4 py-2 text-sm font-bold text-white"
          : "rounded-lg border border-black/10 bg-white px-4 py-2 text-sm font-bold text-admin-ink/70 transition hover:bg-admin-bg"
      }
    >
      {children}
    </button>
  );
}

function IconButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-black/10 text-sm text-admin-ink/70 transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-[22px] w-10 shrink-0 rounded-full transition ${checked ? "bg-admin-green" : "bg-black/15"}`}
    >
      <span
        className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition ${
          checked ? "left-[20px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function NewCategoryForm({ onCreate }: { onCreate: (nombre: string) => Promise<void> }) {
  const [nombre, setNombre] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(nombre.trim());
      setNombre("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la categoría");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`${CARD} flex items-end gap-2 p-3`}>
      <label className="flex flex-1 flex-col gap-1.5 text-sm font-bold text-admin-ink">
        Nueva categoría
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Bebidas"
          className="input"
        />
      </label>
      <button type="submit" disabled={submitting || !nombre.trim()} className={BTN_PRIMARY}>
        Agregar
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function ProductsSection({
  token,
  categoryId,
  canWrite,
}: {
  token: string;
  categoryId: string;
  canWrite: boolean;
}) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchProducts(token, categoryId);
      setProducts(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los productos");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch this category's products when selection changes
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  async function handleToggleDisponible(product: Product) {
    setProducts((prev) =>
      prev ? prev.map((p) => (p.id === product.id ? { ...p, disponible: !product.disponible } : p)) : prev,
    );
    await updateProduct(token, product.id, { disponible: !product.disponible });
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-extrabold uppercase tracking-wide text-admin-ink/55">Productos</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {products === null ? (
        <p className="text-sm text-admin-ink/55">Cargando...</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {products.length === 0 && (
            <li className={`${CARD} p-4 text-sm text-admin-ink/55`}>Esta categoría no tiene productos.</li>
          )}
          {products.map((product) =>
            editingId === product.id ? (
              <li key={product.id} className={`${CARD} p-3`}>
                <ProductForm
                  initial={product}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (payload) => {
                    await updateProduct(token, product.id, payload);
                    await load();
                    setEditingId(null);
                  }}
                />
              </li>
            ) : (
              <li key={product.id} className={`${CARD} flex items-center justify-between gap-3 p-3`}>
                <div className="flex flex-col">
                  <span className={product.disponible ? "font-bold text-admin-ink" : "font-bold text-admin-ink/40"}>
                    {product.nombre}
                  </span>
                  <span className="text-sm text-admin-ink/55">${product.precio}</span>
                </div>
                {canWrite && (
                  <div className="flex items-center gap-3">
                    <button onClick={() => setEditingId(product.id)} className={BTN_SECONDARY}>
                      Editar
                    </button>
                    <ToggleSwitch
                      checked={product.disponible}
                      onChange={() => handleToggleDisponible(product)}
                      label={product.disponible ? "Marcar no disponible" : "Marcar disponible"}
                    />
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {canWrite && (
        <ProductForm
          onSubmit={async (payload) => {
            await createProduct(token, { ...payload, categoryId });
            await load();
          }}
        />
      )}
    </section>
  );
}

interface ProductFormValues {
  nombre: string;
  descripcion?: string;
  precio: number;
  fotoUrl?: string;
}

function ProductForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Product;
  onSubmit: (payload: ProductFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(initial?.descripcion ?? "");
  const [precio, setPrecio] = useState(initial?.precio ?? "");
  const [fotoUrl, setFotoUrl] = useState(initial?.fotoUrl ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const precioNumber = Number(precio);
    if (!nombre.trim() || !Number.isFinite(precioNumber) || precioNumber <= 0) return;

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || undefined,
        precio: precioNumber,
        fotoUrl: fotoUrl.trim() || undefined,
      });
      if (!initial) {
        setNombre("");
        setDescripcion("");
        setPrecio("");
        setFotoUrl("");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el producto");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={initial ? "flex flex-col gap-3" : `${CARD} flex flex-col gap-3 p-4`}>
      <p className="text-sm font-extrabold text-admin-ink">{initial ? "Editar producto" : "Nuevo producto"}</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
          Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Pizza Hawaiana" className="input" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
          Precio
          <input
            type="number"
            min="0"
            step="0.01"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="129.90"
            className="input"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
        Descripción (opcional)
        <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="input" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
        Foto (URL, opcional)
        <input value={fotoUrl} onChange={(e) => setFotoUrl(e.target.value)} placeholder="https://..." className="input" />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className={BTN_PRIMARY}>
          {initial ? "Guardar cambios" : "Agregar producto"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={BTN_SECONDARY}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
