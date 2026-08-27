"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  createCodigoDescuentoB2b,
  deleteCodigoDescuentoB2b,
  fetchCodigosDescuentoB2b,
  updateCodigoDescuentoB2b,
  type CodigoDescuentoB2b,
} from "@/lib/api";
import Card from "../_components/Card";
import Button from "../_components/Button";
import Modal from "../_components/Modal";
import ToggleSwitch from "../_components/ToggleSwitch";

// fechaLimite llega del backend como ISO datetime completo (Prisma DateTime
// serializado, ej. "2026-09-15T00:00:00.000Z") aunque la columna sea
// @db.Date sin hora — mismo truco de slice(0,10) que el resto de la app usa
// para fechas calendario.
function soloFecha(iso: string): string {
  return iso.slice(0, 10);
}

export default function CodigosDescuentoB2bSection({ token }: { token: string }) {
  const [codigos, setCodigos] = useState<CodigoDescuentoB2b[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CodigoDescuentoB2b | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchCodigosDescuentoB2b(token);
      setCodigos(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los códigos de descuento");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleToggleActivo(codigo: CodigoDescuentoB2b) {
    setCodigos((prev) => (prev ? prev.map((c) => (c.id === codigo.id ? { ...c, activo: !codigo.activo } : c)) : prev));
    await updateCodigoDescuentoB2b(token, codigo.id, { activo: !codigo.activo });
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCodigoDescuentoB2b(token, deleteTarget.id);
      setCodigos((prev) => (prev ? prev.filter((c) => c.id !== deleteTarget.id) : prev));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "No se pudo eliminar el código de descuento");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-extrabold text-admin-ink">Códigos de descuento</h2>
        <p className="text-sm text-admin-ink-soft">
          Códigos que tus clientes de mayoreo pueden capturar al armar su pedido semanal.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {codigos === null ? (
        <p className="text-sm text-admin-ink-soft">Cargando...</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {codigos.length === 0 && (
            <li className="rounded-[var(--radius-admin-control)] border border-admin-border p-4 text-sm text-admin-ink-soft">
              Aún no tienes códigos de descuento.
            </li>
          )}
          {codigos.map((codigo) =>
            editingId === codigo.id ? (
              <li key={codigo.id} className="rounded-[var(--radius-admin-control)] border border-admin-border p-3">
                <CodigoDescuentoB2bForm
                  initial={codigo}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (payload) => {
                    await updateCodigoDescuentoB2b(token, codigo.id, payload);
                    await load();
                    setEditingId(null);
                  }}
                />
              </li>
            ) : (
              <li
                key={codigo.id}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-admin-control)] border border-admin-border p-3"
              >
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        codigo.activo
                          ? "text-[15px] font-semibold text-admin-ink"
                          : "text-[15px] font-semibold text-admin-ink/40"
                      }
                    >
                      {codigo.codigo}
                    </span>
                    {!codigo.activo && (
                      <span className="rounded-full bg-admin-bg px-2 py-0.5 text-xs font-medium text-admin-ink-soft">
                        Inactivo
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-admin-ink-soft">{Number(codigo.descuentoPorcentaje)}% de descuento</span>
                  <span className="text-sm text-admin-ink-soft">
                    Usos: {codigo.usosActuales}
                    {codigo.usosMaximos !== null ? ` / ${codigo.usosMaximos}` : " (ilimitado)"}
                  </span>
                  <span className="text-sm text-admin-ink-soft">
                    {codigo.fechaLimite ? `Válido hasta ${soloFecha(codigo.fechaLimite)}` : "Sin fecha límite"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="secondary" size="sm" onClick={() => setEditingId(codigo.id)}>
                    Editar
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setDeleteTarget(codigo)}>
                    Eliminar
                  </Button>
                  <ToggleSwitch
                    checked={codigo.activo}
                    onChange={() => handleToggleActivo(codigo)}
                    label={codigo.activo ? "Desactivar" : "Activar"}
                  />
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <CodigoDescuentoB2bForm
        onSubmit={async (payload) => {
          await createCodigoDescuentoB2b(token, payload);
          await load();
        }}
      />

      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        title={`¿Eliminar "${deleteTarget?.codigo ?? ""}"?`}
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

interface CodigoDescuentoB2bFormValues {
  codigo: string;
  descuentoPorcentaje: number;
  usosMaximos?: number | null;
  fechaLimite?: string | null;
}

function CodigoDescuentoB2bForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: CodigoDescuentoB2b;
  onSubmit: (payload: CodigoDescuentoB2bFormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const [codigo, setCodigo] = useState(initial?.codigo ?? "");
  const [descuentoPorcentaje, setDescuentoPorcentaje] = useState(
    initial ? String(Number(initial.descuentoPorcentaje)) : "",
  );
  // Checkbox desmarcado por default = ilimitado/sin fecha límite — mismo
  // comportamiento que ya tenían los códigos existentes antes de este
  // cambio, así que un código nuevo sin tocar estos checkboxes se comporta
  // exactamente igual que uno viejo.
  const [limitarUsos, setLimitarUsos] = useState(initial?.usosMaximos != null);
  const [usosMaximos, setUsosMaximos] = useState(initial?.usosMaximos != null ? String(initial.usosMaximos) : "");
  const [conFechaLimite, setConFechaLimite] = useState(initial?.fechaLimite != null);
  const [fechaLimite, setFechaLimite] = useState(initial?.fechaLimite ? soloFecha(initial.fechaLimite) : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!codigo.trim()) return;

    const porcentajeNumber = Number(descuentoPorcentaje);
    if (!Number.isFinite(porcentajeNumber) || porcentajeNumber <= 0 || porcentajeNumber > 100) return;

    // Al editar, desmarcar el checkbox debe limpiar el campo (null); al
    // crear, simplemente se omite (undefined) — ambos casos terminan en
    // "ilimitado"/"sin fecha límite", solo cambia si hay algo que limpiar.
    let usosMaximosValue: number | null | undefined;
    if (!limitarUsos) {
      usosMaximosValue = initial ? null : undefined;
    } else {
      const n = Number(usosMaximos);
      if (!Number.isFinite(n) || n <= 0) return;
      usosMaximosValue = n;
    }

    let fechaLimiteValue: string | null | undefined;
    if (!conFechaLimite) {
      fechaLimiteValue = initial ? null : undefined;
    } else {
      if (!fechaLimite) return;
      fechaLimiteValue = fechaLimite;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        codigo: codigo.trim(),
        descuentoPorcentaje: porcentajeNumber,
        usosMaximos: usosMaximosValue,
        fechaLimite: fechaLimiteValue,
      });
      if (!initial) {
        setCodigo("");
        setDescuentoPorcentaje("");
        setLimitarUsos(false);
        setUsosMaximos("");
        setConFechaLimite(false);
        setFechaLimite("");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el código de descuento");
    } finally {
      setSubmitting(false);
    }
  }

  const form = (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-admin-ink">
        {initial ? "Editar código de descuento" : "Nuevo código de descuento"}
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Código
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="VERANO10"
            className="admin-input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          % de descuento
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={descuentoPorcentaje}
            onChange={(e) => setDescuentoPorcentaje(e.target.value)}
            placeholder="10"
            className="admin-input"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-sm font-semibold text-admin-ink">
            <input type="checkbox" checked={limitarUsos} onChange={(e) => setLimitarUsos(e.target.checked)} />
            Limitar el número de usos
          </label>
          {limitarUsos && (
            <input
              type="number"
              min="1"
              step="1"
              value={usosMaximos}
              onChange={(e) => setUsosMaximos(e.target.value)}
              placeholder="10"
              className="admin-input"
            />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-sm font-semibold text-admin-ink">
            <input
              type="checkbox"
              checked={conFechaLimite}
              onChange={(e) => setConFechaLimite(e.target.checked)}
            />
            Poner fecha límite
          </label>
          {conFechaLimite && (
            <input
              type="date"
              value={fechaLimite}
              onChange={(e) => setFechaLimite(e.target.value)}
              className="admin-input"
            />
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
          {initial ? "Guardar cambios" : "Crear código"}
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
