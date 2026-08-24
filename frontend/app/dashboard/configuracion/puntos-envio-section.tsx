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
import Card from "../_components/Card";
import Button from "../_components/Button";
import Modal from "../_components/Modal";
import ToggleSwitch from "../_components/ToggleSwitch";

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
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-extrabold text-admin-ink">Puntos de envío</h2>
        <p className="text-sm text-admin-ink-soft">
          Zonas donde ofreces entrega a domicilio, con un pedido mínimo opcional.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {puntos === null ? (
        <p className="text-sm text-admin-ink-soft">Cargando...</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {puntos.length === 0 && (
            <li className="rounded-[var(--radius-admin-control)] border border-admin-border p-4 text-sm text-admin-ink-soft">
              Aún no tienes puntos de envío.
            </li>
          )}
          {puntos.map((punto) =>
            editingId === punto.id ? (
              <li key={punto.id} className="rounded-[var(--radius-admin-control)] border border-admin-border p-3">
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
              <li
                key={punto.id}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-admin-control)] border border-admin-border p-3"
              >
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        punto.activo
                          ? "text-[15px] font-semibold text-admin-ink"
                          : "text-[15px] font-semibold text-admin-ink/40"
                      }
                    >
                      {punto.nombre}
                    </span>
                    {!punto.activo && (
                      <span className="rounded-full bg-admin-bg px-2 py-0.5 text-xs font-medium text-admin-ink-soft">
                        Inactivo
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-admin-ink-soft">{punto.direccion}</span>
                  {punto.pedidoMinimo && (
                    <span className="text-sm text-admin-ink-soft">Pedido mínimo: ${punto.pedidoMinimo}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="secondary" size="sm" onClick={() => setEditingId(punto.id)}>
                    Editar
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setDeleteTarget(punto)}>
                    Eliminar
                  </Button>
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
    </Card>
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

  const form = (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-admin-ink">
        {initial ? "Editar punto de envío" : "Nuevo punto de envío"}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Zona Centro" className="admin-input" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Pedido mínimo (opcional)
          <input
            type="number"
            min="0"
            step="0.01"
            value={pedidoMinimo}
            onChange={(e) => setPedidoMinimo(e.target.value)}
            placeholder="200.00"
            className="admin-input"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
        Dirección
        <input
          value={direccion}
          onChange={(e) => setDireccion(e.target.value)}
          placeholder="Colonia Centro, CDMX"
          className="admin-input"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {initial ? "Guardar cambios" : "Agregar punto de envío"}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );

  return initial ? form : <div className="rounded-[var(--radius-admin-control)] border border-admin-border p-4">{form}</div>;
}
