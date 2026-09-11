"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  assignModifierGroupToProduct,
  fetchModifierGroups,
  fetchProduct,
  unassignModifierGroupFromProduct,
  type ModifierGroup,
  type ProductDetail,
} from "@/lib/api";
import Card from "../../../_components/Card";
import Button from "../../../_components/Button";

const SECTION_HEADER = "text-[13px] font-semibold uppercase tracking-wide text-admin-ink-soft";
const LINK_BTN_SECONDARY =
  "rounded-[var(--radius-admin-control)] border border-admin-border bg-white px-3 py-1.5 text-xs font-bold text-admin-ink-soft transition hover:bg-admin-bg";

export default function ProductoDetallePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user, token } = useSession();
  const canWrite = user.rol === "GERENTE" || user.rol === "DUENO";

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [allGroups, setAllGroups] = useState<ModifierGroup[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [productData, groups] = await Promise.all([fetchProduct(token, id), fetchModifierGroups(token)]);
      setProduct(productData);
      setAllGroups(groups);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el producto");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-red-600">{error}</p>
        <Link href="/dashboard/catalogo" className={`${LINK_BTN_SECONDARY} self-start`}>
          ← Volver al catálogo
        </Link>
      </div>
    );
  }

  if (!product) {
    return <p className="text-sm text-admin-ink-soft">Cargando...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard/catalogo" className="text-sm font-semibold text-admin-ink-soft hover:text-admin-ink">
        ← Volver al catálogo
      </Link>

      <Card className="flex flex-col gap-1">
        <span className="text-lg font-extrabold text-admin-ink">{product.nombre}</span>
        <span className="text-sm text-admin-ink-soft">
          ${product.precio} · {product.category.nombre}
        </span>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className={SECTION_HEADER}>Modificadores</h2>
        {allGroups.length === 0 ? (
          <Card className="text-sm text-admin-ink-soft">
            Este negocio todavía no tiene grupos de modificadores. Créalos desde el tab &quot;Modificadores&quot; en
            Catálogo y vuelve aquí para asignarlos a este producto.
          </Card>
        ) : (
          <ModifierChecklist
            // Incluye la asignación completa (id+orden) en la key, no solo
            // product.id — ModifierChecklist inicializa `selected` y
            // `asignadosOrden` una sola vez desde props (useState), así que
            // tras un "Guardar selección" exitoso necesita remontarse por
            // completo para no quedarse con el orden/selección previos al
            // guardado (product.id no cambia entre guardados, load() solo
            // trae un objeto `product` nuevo con los mismos datos que sí
            // deben resetear el checklist).
            key={`${product.id}:${product.modifierGroups.map((a) => `${a.modifierGroupId}:${a.orden}`).join(",")}`}
            allGroups={allGroups}
            asignados={product.modifierGroups}
            canWrite={canWrite}
            onSave={async (toAssign, toUnassign, toReorder) => {
              // toAssign ya trae el siguiente `orden` calculado (después de
              // los que se quedan asignados, ya con el reorden por drag
              // aplicado). toReorder son grupos que seguían asignados pero
              // cuyo `orden` cambió por drag-and-drop — mismo endpoint de
              // asignación (upsert), solo actualiza `orden`. Ver
              // ModifierChecklist.
              await Promise.all([
                ...toAssign.map(({ modifierGroupId, orden }) =>
                  assignModifierGroupToProduct(token, modifierGroupId, id, orden),
                ),
                ...toReorder.map(({ modifierGroupId, orden }) =>
                  assignModifierGroupToProduct(token, modifierGroupId, id, orden),
                ),
                ...toUnassign.map((modifierGroupId) => unassignModifierGroupFromProduct(token, modifierGroupId, id)),
              ]);
              await load();
            }}
          />
        )}
      </section>
    </div>
  );
}

function ModifierChecklist({
  allGroups,
  asignados,
  canWrite,
  onSave,
}: {
  allGroups: ModifierGroup[];
  asignados: ProductDetail["modifierGroups"];
  canWrite: boolean;
  onSave: (
    toAssign: { modifierGroupId: string; orden: number }[],
    toUnassign: string[],
    toReorder: { modifierGroupId: string; orden: number }[],
  ) => Promise<void>;
}) {
  // Pertenencia a "Asignados" es estática hasta guardar/recargar — marcar un
  // grupo de Disponibles no lo mueve aquí, y desmarcar uno de Asignados no lo
  // saca de esta lista, en ambos casos hasta que se presiona "Guardar
  // selección" (ver handleSave). asignadosOrden ya viene ordenado por
  // `orden` asc (ProductsService.findOne), es el orden inicial del drag.
  const asignadoIds = new Set(asignados.map((a) => a.modifierGroupId));
  const asignadosPorId = new Map(asignados.map((a) => [a.modifierGroupId, a]));
  const ordenOriginalPorId = new Map(asignados.map((a) => [a.modifierGroupId, a.orden]));
  const ordenOriginal = asignados.map((a) => a.modifierGroupId);

  const [selected, setSelected] = useState<Set<string>>(asignadoIds);
  const [asignadosOrden, setAsignadosOrden] = useState<string[]>(ordenOriginal);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disponibles = allGroups.filter((g) => !asignadoIds.has(g.id));

  const seleccionCambio = selected.size !== asignadoIds.size || [...selected].some((id) => !asignadoIds.has(id));
  const ordenCambio = asignadosOrden.some((groupId, i) => groupId !== ordenOriginal[i]);
  const dirty = seleccionCambio || ordenCambio;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function toggle(groupId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setAsignadosOrden((prev) => {
      const oldIndex = prev.indexOf(active.id as string);
      const newIndex = prev.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      const toUnassign = [...asignadoIds].filter((groupId) => !selected.has(groupId));

      // Nuevo orden secuencial de Asignados tras el drag (0..N-1 según la
      // posición actual) — solo se manda al backend para los que siguen
      // seleccionados (no se van a desasignar) y cuyo orden cambió respecto
      // al que traía el producto al abrir la pantalla.
      const toReorder = asignadosOrden
        .map((modifierGroupId, index) => ({ modifierGroupId, orden: index }))
        .filter(({ modifierGroupId, orden }) => selected.has(modifierGroupId) && ordenOriginalPorId.get(modifierGroupId) !== orden);

      // Los recién marcados en Disponibles se anexan al final del orden ya
      // reordenado (no del orden original) — conviven con un drag hecho en
      // la misma sesión antes de guardar.
      let siguienteOrden = asignadosOrden.length;
      const toAssign = allGroups
        .filter((g) => selected.has(g.id) && !asignadoIds.has(g.id))
        .map((g) => ({ modifierGroupId: g.id, orden: siguienteOrden++ }));

      await onSave(toAssign, toUnassign, toReorder);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la selección de modificadores");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-admin-ink-soft">Asignados</span>
        {asignadosOrden.length === 0 ? (
          <p className="text-sm text-admin-ink-soft">Todavía no hay grupos asignados a este producto.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={asignadosOrden} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col divide-y divide-admin-border">
                {asignadosOrden.map((groupId) => {
                  const group = asignadosPorId.get(groupId)?.modifierGroup;
                  if (!group) return null;
                  return (
                    <AsignadoRow
                      key={groupId}
                      group={group}
                      checked={selected.has(groupId)}
                      onToggle={() => toggle(groupId)}
                      canWrite={canWrite}
                    />
                  );
                })}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-admin-ink-soft">Disponibles</span>
        {disponibles.length === 0 ? (
          <p className="text-sm text-admin-ink-soft">No hay más grupos de modificadores por asignar.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-admin-border">
            {disponibles.map((group) => (
              <li key={group.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <label className="flex flex-1 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(group.id)}
                    onChange={() => toggle(group.id)}
                    disabled={!canWrite}
                    className="h-4 w-4"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-semibold text-admin-ink">{group.nombre}</span>
                    <span className="text-xs text-admin-ink-soft">
                      {group.opciones.length} {group.opciones.length === 1 ? "opción" : "opciones"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {canWrite && (
        <Button onClick={handleSave} disabled={!dirty || submitting} className="self-start">
          {submitting ? "Guardando..." : "Guardar selección"}
        </Button>
      )}
    </Card>
  );
}

// Fila de la lista de Asignados — a diferencia de Disponibles, lleva un
// drag handle propio para no interceptar clicks del checkbox ni del texto
// (los listeners de dnd-kit se aplican solo al handle, no a todo el <li>).
// `disabled: !canWrite` en useSortable apaga tanto el listener como el
// cursor, mismo criterio que `disabled={!canWrite}` ya usa el checkbox.
function AsignadoRow({
  group,
  checked,
  onToggle,
  canWrite,
}: {
  group: ModifierGroup;
  checked: boolean;
  onToggle: () => void;
  canWrite: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: group.id,
    disabled: !canWrite,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 bg-white">
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={!canWrite}
        aria-label={`Reordenar ${group.nombre}`}
        className={`shrink-0 px-1 text-admin-ink-soft ${canWrite ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-not-allowed opacity-40"}`}
      >
        ⠿
      </button>
      <label className="flex flex-1 items-center gap-3 text-sm">
        <input type="checkbox" checked={checked} onChange={onToggle} disabled={!canWrite} className="h-4 w-4" />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold text-admin-ink">{group.nombre}</span>
          <span className="text-xs text-admin-ink-soft">
            {group.opciones.length} {group.opciones.length === 1 ? "opción" : "opciones"}
          </span>
        </span>
      </label>
    </li>
  );
}
