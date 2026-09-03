"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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
            key={product.id}
            allGroups={allGroups}
            asignados={product.modifierGroups}
            canWrite={canWrite}
            onSave={async (toAssign, toUnassign) => {
              // toAssign ya trae el siguiente `orden` calculado — se anexa
              // después de los grupos que se quedan asignados, sin
              // renumerar los que ya tenían un orden guardado (ver
              // ModifierChecklist).
              await Promise.all([
                ...toAssign.map(({ modifierGroupId, orden }) =>
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
  onSave: (toAssign: { modifierGroupId: string; orden: number }[], toUnassign: string[]) => Promise<void>;
}) {
  const asignadoIds = new Set(asignados.map((a) => a.modifierGroupId));
  const [selected, setSelected] = useState<Set<string>>(asignadoIds);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = selected.size !== asignadoIds.size || [...selected].some((id) => !asignadoIds.has(id));

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

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      const toUnassign = [...asignadoIds].filter((groupId) => !selected.has(groupId));
      // Los grupos que se quedan asignados conservan su `orden` guardado —
      // los recién marcados se anexan al final, en el orden en que aparecen
      // en el checklist (mismo orden que ve el dueño, así el storefront los
      // muestra en ese orden). No hay UI de reordenar manualmente, ver
      // CLAUDE.md.
      const ordenesExistentes = asignados.filter((a) => selected.has(a.modifierGroupId)).map((a) => a.orden);
      let siguienteOrden = ordenesExistentes.length > 0 ? Math.max(...ordenesExistentes) + 1 : 0;
      const toAssign = allGroups
        .filter((g) => selected.has(g.id) && !asignadoIds.has(g.id))
        .map((g) => ({ modifierGroupId: g.id, orden: siguienteOrden++ }));

      await onSave(toAssign, toUnassign);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar la selección de modificadores");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-admin-border">
        {allGroups.map((group) => (
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

      {error && <p className="text-sm text-red-600">{error}</p>}

      {canWrite && (
        <Button onClick={handleSave} disabled={!dirty || submitting} className="self-start">
          {submitting ? "Guardando..." : "Guardar selección"}
        </Button>
      )}
    </Card>
  );
}
