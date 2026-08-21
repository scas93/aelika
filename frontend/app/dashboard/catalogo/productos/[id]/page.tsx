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

const CARD = "rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]";
const BTN_PRIMARY =
  "self-start rounded-lg bg-admin-green px-4 py-2 text-sm font-bold text-white transition hover:bg-admin-green-dark disabled:cursor-not-allowed disabled:opacity-40";
const BTN_SECONDARY =
  "rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-bold text-admin-ink/70 transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-40";
const BTN_DANGER =
  "rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-black/10 disabled:text-admin-ink/40 disabled:hover:bg-transparent";

export default function ProductoDetallePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { user, token } = useSession();
  const canWrite = user.rol === "GERENTE" || user.rol === "DUENO";

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [allGroups, setAllGroups] = useState<ModifierGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [unassignError, setUnassignError] = useState<string | null>(null);
  const [unassigningId, setUnassigningId] = useState<string | null>(null);

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

  async function handleUnassign(modifierGroupId: string) {
    setUnassigningId(modifierGroupId);
    setUnassignError(null);
    try {
      await unassignModifierGroupFromProduct(token, modifierGroupId, id);
      await load();
    } catch (err) {
      setUnassignError(err instanceof ApiError ? err.message : "No se pudo desasignar el modificador");
    } finally {
      setUnassigningId(null);
    }
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-red-600">{error}</p>
        <Link href="/dashboard/catalogo" className={`${BTN_SECONDARY} self-start`}>
          ← Volver al catálogo
        </Link>
      </div>
    );
  }

  if (!product) {
    return <p className="text-sm text-admin-ink/55">Cargando...</p>;
  }

  const asignados = product.modifierGroups;
  const disponibles = allGroups.filter((g) => !asignados.some((a) => a.modifierGroupId === g.id));

  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard/catalogo" className="text-sm font-bold text-admin-ink/55 hover:text-admin-ink">
        ← Volver al catálogo
      </Link>

      <section className={`${CARD} flex flex-col gap-1 p-4`}>
        <span className="text-lg font-extrabold text-admin-ink">{product.nombre}</span>
        <span className="text-sm text-admin-ink/55">
          ${product.precio} · {product.category.nombre}
        </span>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-extrabold uppercase tracking-wide text-admin-ink/55">Modificadores asignados</h2>
        {unassignError && <p className="text-sm text-red-600">{unassignError}</p>}
        {asignados.length === 0 ? (
          <p className={`${CARD} p-4 text-sm text-admin-ink/55`}>Este producto no tiene modificadores asignados.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {asignados.map((asignacion) => (
              <li
                key={asignacion.modifierGroupId}
                className={`${CARD} flex items-center justify-between gap-3 p-3`}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-admin-ink">{asignacion.modifierGroup.nombre}</span>
                  <span className="text-xs text-admin-ink/55">
                    Orden {asignacion.orden} · {asignacion.modifierGroup.opciones.length}{" "}
                    {asignacion.modifierGroup.opciones.length === 1 ? "opción" : "opciones"}
                  </span>
                </div>
                {canWrite && (
                  <button
                    onClick={() => handleUnassign(asignacion.modifierGroupId)}
                    disabled={unassigningId === asignacion.modifierGroupId}
                    className={BTN_DANGER}
                  >
                    {unassigningId === asignacion.modifierGroupId ? "Desasignando..." : "Desasignar"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canWrite && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-admin-ink/55">
            Asignar modificador existente
          </h2>
          {disponibles.length === 0 ? (
            <p className={`${CARD} p-4 text-sm text-admin-ink/55`}>
              No hay más grupos de modificadores disponibles para asignar.
            </p>
          ) : (
            <AssignModifierGroupForm
              // Remounts (resetting the internal selection) whenever the
              // available-groups list changes shape — e.g. right after an
              // assign shrinks it — instead of syncing local state via an
              // effect.
              key={disponibles.map((g) => g.id).join(",")}
              groups={disponibles}
              onAssign={async (modifierGroupId, orden) => {
                await assignModifierGroupToProduct(token, modifierGroupId, id, orden);
                await load();
              }}
            />
          )}
        </section>
      )}
    </div>
  );
}

function AssignModifierGroupForm({
  groups,
  onAssign,
}: {
  groups: ModifierGroup[];
  onAssign: (modifierGroupId: string, orden?: number) => Promise<void>;
}) {
  const [modifierGroupId, setModifierGroupId] = useState(groups[0]?.id ?? "");
  const [orden, setOrden] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!modifierGroupId) return;

    const ordenNumber = orden.trim() ? Number(orden) : undefined;
    if (ordenNumber !== undefined && (!Number.isFinite(ordenNumber) || ordenNumber < 0)) {
      setError("El orden debe ser un número mayor o igual a 0");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onAssign(modifierGroupId, ordenNumber);
      setOrden("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo asignar el modificador");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`${CARD} flex items-end gap-3 p-4`}>
      <label className="flex flex-1 flex-col gap-1.5 text-sm font-bold text-admin-ink">
        Grupo de modificadores
        <select value={modifierGroupId} onChange={(e) => setModifierGroupId(e.target.value)} className="input">
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nombre}
            </option>
          ))}
        </select>
      </label>
      <label className="flex w-28 flex-col gap-1.5 text-sm font-bold text-admin-ink">
        Orden (opcional)
        <input
          type="number"
          min="0"
          step="1"
          value={orden}
          onChange={(e) => setOrden(e.target.value)}
          placeholder="0"
          className="input"
        />
      </label>
      <button type="submit" disabled={submitting} className={BTN_PRIMARY}>
        {submitting ? "Asignando..." : "Asignar"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
