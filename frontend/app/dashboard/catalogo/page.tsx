"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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
import ModifiersSection from "./modifiers-section";
import Card from "../_components/Card";
import Button from "../_components/Button";
import Tabs from "../_components/Tabs";
import Modal from "../_components/Modal";
import ToggleSwitch from "../_components/ToggleSwitch";
import SidePanel from "../_components/SidePanel";

type Tab = "catalogo" | "promociones" | "modificadores";

const SECTION_HEADER = "text-[13px] font-semibold uppercase tracking-wide text-admin-ink-soft";
const LINK_BTN_SECONDARY =
  "rounded-[var(--radius-admin-control)] border border-admin-border bg-white px-3 py-1.5 text-xs font-bold text-admin-ink-soft transition hover:bg-admin-bg";

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
  const [categoryPanelOpen, setCategoryPanelOpen] = useState(false);

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
      <Tabs
        items={[
          { key: "catalogo", label: "Categorías y productos", icon: "📋" },
          { key: "promociones", label: "Promociones", icon: "🏷️" },
          { key: "modificadores", label: "Modificadores", icon: "🧩" },
        ]}
        active={tab}
        onChange={(key) => setTab(key as Tab)}
      />

      {tab === "promociones" ? (
        <PromotionsSection token={token} canWrite={canWrite} />
      ) : tab === "modificadores" ? (
        <ModifiersSection token={token} canWrite={canWrite} />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className={SECTION_HEADER}>Categorías</h2>
              {canWrite && (
                <Button variant="primary" size="sm" onClick={() => setCategoryPanelOpen(true)}>
                  + Nueva categoría
                </Button>
              )}
            </div>
            {categoriesError && <p className="text-sm text-red-600">{categoriesError}</p>}
            {categories === null ? (
              <p className="text-sm text-admin-ink-soft">Cargando...</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {categories.length === 0 && (
                  <li>
                    <Card className="text-sm text-admin-ink-soft">Aún no tienes categorías.</Card>
                  </li>
                )}
                {categories.map((category, index) => (
                  <li key={category.id}>
                    <Card
                      padding={12}
                      className={`flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3 ${
                        selectedCategoryId === category.id ? "ring-2 ring-admin-green/40" : ""
                      }`}
                    >
                      <button
                        onClick={() => setSelectedCategoryId(category.id)}
                        className="flex flex-1 items-center gap-2 text-left"
                      >
                        <span
                          className={
                            category.activa
                              ? "text-[15px] font-semibold text-admin-ink"
                              : "text-[15px] font-semibold text-admin-ink/40"
                          }
                        >
                          {category.nombre}
                        </span>
                        {!category.activa && (
                          <span className="rounded-full bg-admin-bg px-2 py-0.5 text-xs font-medium text-admin-ink-soft">
                            Inactiva
                          </span>
                        )}
                      </button>

                      {canWrite && (
                        <div className="flex flex-wrap items-center gap-1.5">
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
                          <Button variant="secondary" size="sm" onClick={() => handleToggleActiva(category)}>
                            {category.activa ? "Desactivar" : "Activar"}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setDeleteTarget(category)}
                            disabled={category._count.products > 0}
                            title={category._count.products > 0 ? "Tiene productos" : undefined}
                          >
                            Eliminar
                          </Button>
                          {category._count.products > 0 && (
                            <span className="text-[13px] text-admin-ink-soft">Tiene productos</span>
                          )}
                        </div>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <NewCategoryPanel
            open={categoryPanelOpen}
            onClose={() => setCategoryPanelOpen(false)}
            onCreate={handleCreateCategory}
          />

          <Modal
            open={deleteTarget !== null}
            onClose={() => {
              setDeleteTarget(null);
              setDeleteError(null);
            }}
            title={`¿Eliminar la categoría ${deleteTarget?.nombre ?? ""}?`}
            footer={
              <>
                <Button variant="primary" onClick={handleDeleteConfirm} disabled={deleting}>
                  {deleting ? "Eliminando..." : "Eliminar"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDeleteTarget(null);
                    setDeleteError(null);
                  }}
                  disabled={deleting}
                >
                  Cancelar
                </Button>
              </>
            }
          >
            <p className="text-sm text-admin-ink-soft">Esta acción no se puede deshacer.</p>
            {deleteError && <p className="text-sm text-red-600">{deleteError}</p>}
          </Modal>

          {selectedCategoryId && (
            <ProductsSection key={selectedCategoryId} token={token} categoryId={selectedCategoryId} canWrite={canWrite} />
          )}
        </>
      )}
    </div>
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
      className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-admin-control)] bg-admin-bg text-sm text-admin-ink-soft transition hover:bg-admin-border disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function NewCategoryPanel({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (nombre: string) => Promise<void>;
}) {
  const [nombre, setNombre] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  function resetForm() {
    setNombre("");
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the form each time the panel opens
    resetForm();
  }, [open]);

  async function handleSubmit(keepOpen: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(nombre.trim());
      setNombre("");
      if (keepOpen) {
        firstFieldRef.current?.focus();
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la categoría");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = nombre.trim().length > 0 && !submitting;

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Nueva categoría"
      footer={
        <>
          <Button variant="secondary" onClick={() => handleSubmit(true)} disabled={!canSubmit}>
            Agregar y crear otro
          </Button>
          <Button variant="primary" onClick={() => handleSubmit(false)} disabled={!canSubmit}>
            Agregar categoría
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Nombre
          <input
            ref={firstFieldRef}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Bebidas"
            className="admin-input"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </SidePanel>
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
  const [productPanelOpen, setProductPanelOpen] = useState(false);

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
      <div className="flex items-center justify-between">
        <h2 className={SECTION_HEADER}>Productos</h2>
        {canWrite && (
          <Button variant="primary" size="sm" onClick={() => setProductPanelOpen(true)}>
            + Agregar producto
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {products === null ? (
        <p className="text-sm text-admin-ink-soft">Cargando...</p>
      ) : products.length === 0 ? (
        <Card className="text-sm text-admin-ink-soft">Esta categoría no tiene productos.</Card>
      ) : (
        <Card padding={0} className="overflow-hidden">
          <ul className="flex flex-col divide-y divide-admin-border">
            {products.map((product) =>
              editingId === product.id ? (
                <li key={product.id} className="p-4">
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
                <li
                  key={product.id}
                  className="flex flex-col gap-2 px-4 py-3 transition hover:bg-admin-bg md:h-16 md:flex-row md:items-center md:justify-between md:py-0"
                >
                  <div className="flex flex-col">
                    <span
                      className={
                        product.disponible
                          ? "text-[15px] font-semibold text-admin-ink"
                          : "text-[15px] font-semibold text-admin-ink/40"
                      }
                    >
                      {product.nombre}
                    </span>
                    <span className="text-sm text-admin-ink-soft">${product.precio}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link href={`/dashboard/catalogo/productos/${product.id}`} className={LINK_BTN_SECONDARY}>
                      Ver detalle
                    </Link>
                    {canWrite && (
                      <>
                        <Button variant="secondary" size="sm" onClick={() => setEditingId(product.id)}>
                          Editar
                        </Button>
                        <ToggleSwitch
                          checked={product.disponible}
                          onChange={() => handleToggleDisponible(product)}
                          label={product.disponible ? "Marcar no disponible" : "Marcar disponible"}
                        />
                      </>
                    )}
                  </div>
                </li>
              ),
            )}
          </ul>
        </Card>
      )}

      <NewProductPanel
        open={productPanelOpen}
        onClose={() => setProductPanelOpen(false)}
        onCreate={async (payload) => {
          await createProduct(token, { ...payload, categoryId });
          await load();
        }}
      />
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

  const form = (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-[17px] font-bold text-admin-ink">{initial ? "Editar producto" : "Nuevo producto"}</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Nombre
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Pizza Hawaiana"
            className="admin-input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Precio
          <input
            type="number"
            min="0"
            step="0.01"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="129.90"
            className="admin-input"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
        Descripción (opcional)
        <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="admin-input" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
        Foto (URL, opcional)
        <input value={fotoUrl} onChange={(e) => setFotoUrl(e.target.value)} placeholder="https://..." className="admin-input" />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {initial ? "Guardar cambios" : "Agregar producto"}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );

  return initial ? form : <Card>{form}</Card>;
}

function NewProductPanel({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: ProductFormValues) => Promise<void>;
}) {
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [precio, setPrecio] = useState("");
  const [fotoUrl, setFotoUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  function resetForm() {
    setNombre("");
    setDescripcion("");
    setPrecio("");
    setFotoUrl("");
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the form each time the panel opens
    resetForm();
  }, [open]);

  const precioNumber = Number(precio);
  const canSubmit = nombre.trim().length > 0 && Number.isFinite(precioNumber) && precioNumber > 0 && !submitting;

  async function handleSubmit(keepOpen: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || undefined,
        precio: precioNumber,
        fotoUrl: fotoUrl.trim() || undefined,
      });
      setNombre("");
      setDescripcion("");
      setPrecio("");
      setFotoUrl("");
      if (keepOpen) {
        firstFieldRef.current?.focus();
      } else {
        onClose();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el producto");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Nuevo producto"
      footer={
        <>
          <Button variant="secondary" onClick={() => handleSubmit(true)} disabled={!canSubmit}>
            Agregar y crear otro
          </Button>
          <Button variant="primary" onClick={() => handleSubmit(false)} disabled={!canSubmit}>
            Agregar producto
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Nombre
          <input
            ref={firstFieldRef}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Pizza Hawaiana"
            className="admin-input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Precio
          <input
            type="number"
            min="0"
            step="0.01"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="129.90"
            className="admin-input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Descripción (opcional)
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="admin-input" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Foto (URL, opcional)
          <input
            value={fotoUrl}
            onChange={(e) => setFotoUrl(e.target.value)}
            placeholder="https://..."
            className="admin-input"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </SidePanel>
  );
}
