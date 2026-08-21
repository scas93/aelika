"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  createModifierGroup,
  createModifierOption,
  deleteModifierGroup,
  deleteModifierOption,
  fetchModifierGroups,
  updateModifierGroup,
  updateModifierOption,
  type ModifierGroup,
  type TipoSeleccion,
} from "@/lib/api";

const CARD = "rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]";
const BTN_PRIMARY =
  "self-start rounded-lg bg-admin-green px-4 py-2 text-sm font-bold text-white transition hover:bg-admin-green-dark disabled:cursor-not-allowed disabled:opacity-40";
const BTN_SECONDARY =
  "rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-bold text-admin-ink/70 transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-40";
const BTN_DANGER =
  "rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-black/10 disabled:text-admin-ink/40 disabled:hover:bg-transparent";

const TIPO_SELECCION_LABEL: Record<TipoSeleccion, string> = {
  UNICA: "Selección única",
  MULTIPLE: "Selección múltiple",
};

interface OpcionRow {
  id?: string;
  nombre: string;
  precioAdicional: string;
}

function nuevaFila(): OpcionRow {
  return { nombre: "", precioAdicional: "" };
}

export default function ModifiersSection({ token, canWrite }: { token: string; canWrite: boolean }) {
  const [groups, setGroups] = useState<ModifierGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ModifierGroup | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchModifierGroups(token);
      setGroups(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los modificadores");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteModifierGroup(token, deleteTarget.id);
      setGroups((prev) => (prev ? prev.filter((g) => g.id !== deleteTarget.id) : prev));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "No se pudo eliminar el grupo de modificadores");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-extrabold uppercase tracking-wide text-admin-ink/55">Modificadores</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {groups === null ? (
        <p className="text-sm text-admin-ink/55">Cargando...</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {groups.length === 0 && (
            <li className={`${CARD} p-4 text-sm text-admin-ink/55`}>Aún no tienes grupos de modificadores.</li>
          )}
          {groups.map((group) =>
            editingId === group.id ? (
              <li key={group.id} className={`${CARD} p-4`}>
                <NewModifierGroupForm
                  initial={group}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async () => {
                    await load();
                    setEditingId(null);
                  }}
                  token={token}
                />
              </li>
            ) : (
              <li key={group.id} className={`${CARD} flex items-center justify-between gap-3 p-3`}>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-admin-ink">{group.nombre}</span>
                  <span className="text-xs text-admin-ink/55">
                    {TIPO_SELECCION_LABEL[group.tipoSeleccion]}
                    {group.obligatorio ? " · Obligatorio" : " · Opcional"} · {group.opciones.length}{" "}
                    {group.opciones.length === 1 ? "opción" : "opciones"}
                  </span>
                </div>
                {canWrite && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditingId(group.id)} className={BTN_SECONDARY}>
                      Editar
                    </button>
                    <button onClick={() => setDeleteTarget(group)} className={BTN_DANGER}>
                      Eliminar
                    </button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {canWrite &&
        (creating ? (
          <div className={`${CARD} p-4`}>
            <NewModifierGroupForm
              token={token}
              onCancel={() => setCreating(false)}
              onSubmit={async () => {
                await load();
                setCreating(false);
              }}
            />
          </div>
        ) : (
          <button onClick={() => setCreating(true)} className={BTN_PRIMARY}>
            + Nuevo grupo de modificadores
          </button>
        ))}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-sm flex-col gap-4 rounded-[14px] bg-white p-6 shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
            <h3 className="text-lg font-extrabold text-admin-ink">¿Eliminar &ldquo;{deleteTarget.nombre}&rdquo;?</h3>
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
    </section>
  );
}

function NewModifierGroupForm({
  token,
  initial,
  onSubmit,
  onCancel,
}: {
  token: string;
  initial?: ModifierGroup;
  onSubmit: () => Promise<void>;
  onCancel?: () => void;
}) {
  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [tipoSeleccion, setTipoSeleccion] = useState<TipoSeleccion>(initial?.tipoSeleccion ?? "UNICA");
  const [obligatorio, setObligatorio] = useState(initial?.obligatorio ?? false);
  const [opciones, setOpciones] = useState<OpcionRow[]>(
    initial
      ? initial.opciones.map((o) => ({ id: o.id, nombre: o.nombre, precioAdicional: o.precioAdicional }))
      : [nuevaFila()],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateFila(index: number, patch: Partial<OpcionRow>) {
    setOpciones((prev) => prev.map((fila, i) => (i === index ? { ...fila, ...patch } : fila)));
  }

  function agregarFila() {
    setOpciones((prev) => [...prev, nuevaFila()]);
  }

  function borrarFila(index: number) {
    setOpciones((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!nombre.trim()) return;
    const opcionesValidas = opciones.every((fila) => {
      const precio = Number(fila.precioAdicional);
      return fila.nombre.trim().length > 0 && Number.isFinite(precio) && precio >= 0;
    });
    if (!opcionesValidas) {
      setError("Cada opción necesita un nombre y un precio adicional válido (0 o mayor)");
      return;
    }

    setSubmitting(true);
    try {
      if (!initial) {
        await createModifierGroup(token, {
          nombre: nombre.trim(),
          tipoSeleccion,
          obligatorio,
          opciones: opciones.map((fila) => ({
            nombre: fila.nombre.trim(),
            precioAdicional: Number(fila.precioAdicional),
          })),
        });
      } else {
        await updateModifierGroup(token, initial.id, {
          nombre: nombre.trim(),
          tipoSeleccion,
          obligatorio,
        });

        // El PATCH del grupo no toca sus opciones — cada fila se reconcilia
        // por separado contra los endpoints propios de ModifierOption
        // (crear/actualizar/borrar), ya que el backend no expone un update
        // anidado para ellas.
        const originalIds = new Set(initial.opciones.map((o) => o.id));
        const idsActuales = new Set(opciones.filter((f) => f.id).map((f) => f.id));

        const eliminadas = initial.opciones.filter((o) => !idsActuales.has(o.id));
        const nuevas = opciones.filter((f) => !f.id);
        const existentes = opciones.filter((f) => f.id && originalIds.has(f.id));

        await Promise.all([
          ...eliminadas.map((o) => deleteModifierOption(token, o.id)),
          ...nuevas.map((f) =>
            createModifierOption(token, initial.id, {
              nombre: f.nombre.trim(),
              precioAdicional: Number(f.precioAdicional),
            }),
          ),
          ...existentes.map((f) =>
            updateModifierOption(token, f.id!, {
              nombre: f.nombre.trim(),
              precioAdicional: Number(f.precioAdicional),
            }),
          ),
        ]);
      }

      await onSubmit();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el grupo de modificadores");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-sm font-extrabold text-admin-ink">
        {initial ? "Editar grupo de modificadores" : "Nuevo grupo de modificadores"}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
          Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tamaño" className="input" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
          Tipo de selección
          <select
            value={tipoSeleccion}
            onChange={(e) => setTipoSeleccion(e.target.value as TipoSeleccion)}
            className="input"
          >
            <option value="UNICA">Selección única</option>
            <option value="MULTIPLE">Selección múltiple</option>
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm font-bold text-admin-ink">
        <input type="checkbox" checked={obligatorio} onChange={(e) => setObligatorio(e.target.checked)} />
        Obligatorio (el cliente debe elegir al menos una opción)
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold text-admin-ink">Opciones</span>
        <div className="flex flex-col gap-2">
          {opciones.map((fila, index) => (
            <div key={fila.id ?? `nueva-${index}`} className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1.5 text-xs font-bold text-admin-ink">
                Nombre
                <input
                  value={fila.nombre}
                  onChange={(e) => updateFila(index, { nombre: e.target.value })}
                  placeholder="Chica"
                  className="input"
                />
              </label>
              <label className="flex w-32 flex-col gap-1.5 text-xs font-bold text-admin-ink">
                Precio adicional
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={fila.precioAdicional}
                  onChange={(e) => updateFila(index, { precioAdicional: e.target.value })}
                  placeholder="0.00"
                  className="input"
                />
              </label>
              <button
                type="button"
                onClick={() => borrarFila(index)}
                disabled={opciones.length <= 1}
                className={BTN_SECONDARY}
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={agregarFila} className={`${BTN_SECONDARY} self-start`}>
          + Agregar opción
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className={BTN_PRIMARY}>
          {submitting ? "Guardando..." : initial ? "Guardar cambios" : "Crear grupo"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={submitting} className={BTN_SECONDARY}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
