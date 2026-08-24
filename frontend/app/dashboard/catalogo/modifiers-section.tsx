"use client";

import { useEffect, useRef, useState } from "react";
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
import Card from "../_components/Card";
import Button from "../_components/Button";
import Badge from "../_components/Badge";
import Modal from "../_components/Modal";
import SidePanel from "../_components/SidePanel";

const SECTION_HEADER = "text-[13px] font-semibold uppercase tracking-wide text-admin-ink-soft";

const TIPO_SELECCION_LABEL: Record<TipoSeleccion, string> = {
  UNICA: "Selección única",
  MULTIPLE: "Selección múltiple",
};

// Soft bg / saturated text pair per selection type, same formula as the
// promotion-type badges in promotions-section.tsx.
const TIPO_SELECCION_BADGE_CLASSES: Record<TipoSeleccion, string> = {
  UNICA: "bg-[#DBEAFE] text-[#3B82F6]",
  MULTIPLE: "bg-[#FCE7F3] text-[#EC4899]",
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
      <div className="flex items-center justify-between">
        <h2 className={SECTION_HEADER}>Modificadores</h2>
        {canWrite && (
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            + Nuevo grupo de modificador
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {groups === null ? (
        <p className="text-sm text-admin-ink-soft">Cargando...</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {groups.length === 0 && (
            <li>
              <Card className="text-sm text-admin-ink-soft">Aún no tienes grupos de modificadores.</Card>
            </li>
          )}
          {groups.map((group) =>
            // Edit stays inline, replacing the row — deliberately not moved
            // to SidePanel, same precedent as ProductForm in Catálogo
            // (Fase 6/8c-aud). Only creation (below) uses the panel.
            editingId === group.id ? (
              <li key={group.id}>
                <Card>
                  <NewModifierGroupForm
                    initial={group}
                    onCancel={() => setEditingId(null)}
                    onSubmit={async () => {
                      await load();
                      setEditingId(null);
                    }}
                    token={token}
                  />
                </Card>
              </li>
            ) : (
              <li key={group.id}>
                <Card padding={12} className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-admin-ink">{group.nombre}</span>
                    <div className="flex items-center gap-2">
                      <Badge color={TIPO_SELECCION_BADGE_CLASSES[group.tipoSeleccion]}>
                        {TIPO_SELECCION_LABEL[group.tipoSeleccion]}
                      </Badge>
                      <span className="text-xs text-admin-ink-soft">
                        {group.obligatorio ? "Obligatorio" : "Opcional"} · {group.opciones.length}{" "}
                        {group.opciones.length === 1 ? "opción" : "opciones"}
                      </span>
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setEditingId(group.id)}>
                        Editar
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => setDeleteTarget(group)}>
                        Eliminar
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            ),
          )}
        </ul>
      )}

      {canWrite && (
        <SidePanel open={creating} onClose={() => setCreating(false)} title="Nuevo grupo de modificadores">
          <NewModifierGroupForm
            token={token}
            onSubmit={async () => {
              await load();
              setCreating(false);
            }}
            onSubmitKeepOpen={async () => {
              await load();
            }}
          />
        </SidePanel>
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        title={`¿Eliminar "${deleteTarget?.nombre ?? ""}"?`}
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
    </section>
  );
}

function NewModifierGroupForm({
  token,
  initial,
  onSubmit,
  onSubmitKeepOpen,
  onCancel,
}: {
  token: string;
  initial?: ModifierGroup;
  // Called after a successful save when the panel/card should close —
  // used by both the edit flow and the create flow's "Agregar grupo".
  onSubmit: () => Promise<void>;
  // Create-only: called after a successful save that keeps the panel open
  // ("Agregar y crear otro") — just refreshes the list, doesn't close.
  onSubmitKeepOpen?: () => Promise<void>;
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
  const nombreRef = useRef<HTMLInputElement>(null);

  function updateFila(index: number, patch: Partial<OpcionRow>) {
    setOpciones((prev) => prev.map((fila, i) => (i === index ? { ...fila, ...patch } : fila)));
  }

  function agregarFila() {
    setOpciones((prev) => [...prev, nuevaFila()]);
  }

  function borrarFila(index: number) {
    setOpciones((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  // Create-only reset for "Agregar y crear otro" — opciones must land on
  // exactly one blank row, never [] or undefined, since agregarFila/
  // borrarFila (and the "Quitar" button's disabled guard) assume there's
  // always at least one row. See CLAUDE.md, Fase 8c-aud.
  function resetForm() {
    setNombre("");
    setTipoSeleccion("UNICA");
    setObligatorio(false);
    setOpciones([nuevaFila()]);
    setError(null);
  }

  async function doSubmit(keepOpen: boolean) {
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
        // Creation always goes through this branch — the reconciliation
        // diff below (delete/update/create) never runs here, only
        // createModifierGroup's own nested `opciones` create.
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

      if (keepOpen) {
        await onSubmitKeepOpen?.();
        resetForm();
        nombreRef.current?.focus();
      } else {
        await onSubmit();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el grupo de modificadores");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await doSubmit(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* SidePanel already shows "Nuevo grupo de modificadores" as its own
          title when creating — this heading only renders for edit, where
          it's the sole title (inline Card has none of its own). */}
      {initial && <p className="text-[17px] font-bold text-admin-ink">Editar grupo de modificadores</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Nombre
          <input
            ref={nombreRef}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Tamaño"
            className="admin-input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Tipo de selección
          <select
            value={tipoSeleccion}
            onChange={(e) => setTipoSeleccion(e.target.value as TipoSeleccion)}
            className="admin-input"
          >
            <option value="UNICA">Selección única</option>
            <option value="MULTIPLE">Selección múltiple</option>
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm font-semibold text-admin-ink">
        <input type="checkbox" checked={obligatorio} onChange={(e) => setObligatorio(e.target.checked)} />
        Obligatorio (el cliente debe elegir al menos una opción)
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-admin-ink">Opciones</span>
        <div className="flex flex-col gap-2">
          {opciones.map((fila, index) => (
            <div key={fila.id ?? `nueva-${index}`} className="flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1.5 text-xs font-semibold text-admin-ink">
                Nombre
                <input
                  value={fila.nombre}
                  onChange={(e) => updateFila(index, { nombre: e.target.value })}
                  placeholder="Chica"
                  className="admin-input"
                />
              </label>
              <label className="flex w-32 flex-col gap-1.5 text-xs font-semibold text-admin-ink">
                Precio adicional
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={fila.precioAdicional}
                  onChange={(e) => updateFila(index, { precioAdicional: e.target.value })}
                  placeholder="0.00"
                  className="admin-input"
                />
              </label>
              <Button type="button" variant="secondary" size="sm" onClick={() => borrarFila(index)} disabled={opciones.length <= 1}>
                Quitar
              </Button>
            </div>
          ))}
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={agregarFila} className="self-start">
          + Agregar opción
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Guardando..." : initial ? "Guardar cambios" : "Agregar grupo"}
        </Button>
        {!initial && (
          <Button type="button" variant="secondary" disabled={submitting} onClick={() => doSubmit(true)}>
            Agregar y crear otro
          </Button>
        )}
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
