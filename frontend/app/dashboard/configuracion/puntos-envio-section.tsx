"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  createPuntoEnvio,
  deletePuntoEnvio,
  fetchPuntosEnvio,
  updatePuntoEnvio,
  type PuntoEnvio,
} from "@/lib/api";

const CARD = "rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]";
const BTN_PRIMARY =
  "rounded-lg bg-admin-green px-4 py-2 text-sm font-bold text-white transition hover:bg-admin-green-dark disabled:cursor-not-allowed disabled:opacity-40";
const BTN_SECONDARY =
  "rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-bold text-admin-ink/70 transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-40";
const BTN_DANGER =
  "rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-black/10 disabled:text-admin-ink/40 disabled:hover:bg-transparent";

export default function PuntosEnvioSection({ token }: { token: string }) {
  const [puntos, setPuntos] = useState<PuntoEnvio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PuntoEnvio | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchPuntosEnvio(token);
      setPuntos(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los puntos de envío");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleToggleActivo(punto: PuntoEnvio) {
    setPuntos((prev) => (prev ? prev.map((p) => (p.id === punto.id ? { ...p, activo: !punto.activo } : p)) : prev));
    await updatePuntoEnvio(token, punto.id, { activo: !punto.activo });
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deletePuntoEnvio(token, deleteTarget.id);
      setPuntos((prev) => (prev ? prev.filter((p) => p.id !== deleteTarget.id) : prev));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "No se pudo eliminar el punto de envío");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-extrabold text-admin-ink">Puntos de envío</h2>
        <p className="text-sm text-admin-ink/55">
          Zonas donde ofreces entrega a domicilio, con un pedido mínimo opcional.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {puntos === null ? (
        <p className="text-sm text-admin-ink/55">Cargando...</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {puntos.length === 0 && (
            <li className={`${CARD} p-4 text-sm text-admin-ink/55`}>Aún no tienes puntos de envío.</li>
          )}
          {puntos.map((punto) =>
            editingId === punto.id ? (
              <li key={punto.id} className={`${CARD} p-3`}>
                <PuntoEnvioForm
                  initial={punto}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (payload) => {
                    await updatePuntoEnvio(token, punto.id, payload);
                    await load();
                    setEditingId(null);
                  }}
                />
              </li>
            ) : (
              <li key={punto.id} className={`${CARD} flex items-center justify-between gap-3 p-3`}>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className={punto.activo ? "font-bold text-admin-ink" : "font-bold text-admin-ink/40"}>
                      {punto.nombre}
                    </span>
                    {!punto.activo && (
                      <span className="rounded-full bg-admin-bg px-2 py-0.5 text-xs font-medium text-admin-ink/55">
                        Inactivo
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-admin-ink/55">{punto.direccion}</span>
                  {punto.pedidoMinimo && (
                    <span className="text-sm text-admin-ink/55">Pedido mínimo: ${punto.pedidoMinimo}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setEditingId(punto.id)} className={BTN_SECONDARY}>
                    Editar
                  </button>
                  <button onClick={() => setDeleteTarget(punto)} className={BTN_DANGER}>
                    Eliminar
                  </button>
                  <ToggleSwitch
                    checked={punto.activo}
                    onChange={() => handleToggleActivo(punto)}
                    label={punto.activo ? "Desactivar" : "Activar"}
                  />
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <PuntoEnvioForm
        onSubmit={async (payload) => {
          await createPuntoEnvio(token, payload);
          await load();
        }}
      />

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

interface PuntoEnvioFormValues {
  nombre: string;
  direccion: string;
  pedidoMinimo?: number;
}

function PuntoEnvioForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: PuntoEnvio;
  onSubmit: (payload: PuntoEnvioFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [direccion, setDireccion] = useState(initial?.direccion ?? "");
  const [pedidoMinimo, setPedidoMinimo] = useState(initial?.pedidoMinimo ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || !direccion.trim()) return;

    const minimoNumber = pedidoMinimo === "" ? undefined : Number(pedidoMinimo);
    if (minimoNumber !== undefined && (!Number.isFinite(minimoNumber) || minimoNumber <= 0)) return;

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ nombre: nombre.trim(), direccion: direccion.trim(), pedidoMinimo: minimoNumber });
      if (!initial) {
        setNombre("");
        setDireccion("");
        setPedidoMinimo("");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el punto de envío");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={initial ? "flex flex-col gap-3" : `${CARD} flex flex-col gap-3 p-4`}>
      <p className="text-sm font-extrabold text-admin-ink">
        {initial ? "Editar punto de envío" : "Nuevo punto de envío"}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
          Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Zona Centro" className="input" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
          Pedido mínimo (opcional)
          <input
            type="number"
            min="0"
            step="0.01"
            value={pedidoMinimo}
            onChange={(e) => setPedidoMinimo(e.target.value)}
            placeholder="200.00"
            className="input"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
        Dirección
        <input
          value={direccion}
          onChange={(e) => setDireccion(e.target.value)}
          placeholder="Colonia Centro, CDMX"
          className="input"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={submitting} className={BTN_PRIMARY}>
          {initial ? "Guardar cambios" : "Agregar punto de envío"}
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
