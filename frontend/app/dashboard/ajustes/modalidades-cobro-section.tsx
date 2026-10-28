"use client";

import { useState } from "react";
import { ApiError, fetchUsoModalidadesCobro, updateTenantSettings, type ModalidadPagoB2b } from "@/lib/api";
import { MODALIDADES_COBRO, MODALIDAD_DESCRIPCION, MODALIDAD_LABEL } from "@/lib/modalidades-cobro";
import Card from "../_components/Card";
import Button from "../_components/Button";
import Modal from "../_components/Modal";

/**
 * Modalidades de cobro de un negocio de mayoreo (solo Admin). Al menos una debe quedar activa. Si se desactiva una que
 * tienen clientes, se avisa cuántos (clientes activos, sin baja) y se pide confirmación: ellos la conservan y sus pedidos
 * nuevos la siguen usando.
 */
export default function ModalidadesCobroSection({
  token,
  activas,
  onUpdated,
}: {
  token: string;
  activas: ModalidadPagoB2b[];
  onUpdated: (activas: ModalidadPagoB2b[]) => void;
}) {
  const [seleccion, setSeleccion] = useState<ModalidadPagoB2b[]>(activas);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enUso, setEnUso] = useState<{ modalidad: ModalidadPagoB2b; clientes: number }[] | null>(null);

  const ninguna = seleccion.length === 0;
  const hayCambios = MODALIDADES_COBRO.some((m) => seleccion.includes(m) !== activas.includes(m));

  function alternar(m: ModalidadPagoB2b) {
    setSeleccion((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
    setSaved(false);
    setError(null);
  }

  async function guardar() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const settings = await updateTenantSettings(token, { modalidadesCobroB2b: MODALIDADES_COBRO.filter((m) => seleccion.includes(m)) });
      onUpdated(settings.modalidadesCobroB2b);
      setSeleccion(settings.modalidadesCobroB2b);
      setSaved(true);
      setEnUso(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron guardar las modalidades de cobro");
      setEnUso(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (ninguna || !hayCambios) return;
    const desactivadas = activas.filter((m) => !seleccion.includes(m));
    if (desactivadas.length > 0) {
      setSaving(true);
      setError(null);
      try {
        const uso = await fetchUsoModalidadesCobro(token);
        const afectadas = desactivadas.filter((m) => (uso[m] ?? 0) > 0).map((m) => ({ modalidad: m, clientes: uso[m] }));
        if (afectadas.length > 0) {
          setEnUso(afectadas);
          setSaving(false);
          return;
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "No se pudo revisar qué clientes usan esa modalidad");
        setSaving(false);
        return;
      }
    }
    await guardar();
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-admin-ink">Modalidades de cobro</h2>
          <p className="text-sm text-admin-ink-soft">
            Elige cómo cobras a tus clientes de mayoreo. Cada cliente tiene su modalidad; solo puedes asignarle las que estén activas.
          </p>
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">Modalidades de cobro activas</legend>
          {MODALIDADES_COBRO.map((m) => (
            <label key={m} className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={seleccion.includes(m)} onChange={() => alternar(m)} className="mt-1" />
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-admin-ink">{MODALIDAD_LABEL[m]}</span>
                <span className="text-sm text-admin-ink-soft">{MODALIDAD_DESCRIPCION[m]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {ninguna && <p className="text-sm text-red-600">Debe quedar activa al menos una modalidad.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && !error && <p className="text-sm text-admin-green-dark">Guardado.</p>}

        <Button type="submit" disabled={saving || ninguna || !hayCambios} className="self-start">
          {saving ? "Guardando..." : "Guardar"}
        </Button>
      </form>

      <Modal
        open={enUso !== null}
        onClose={() => {
          if (!saving) setEnUso(null);
        }}
        title="Desactivar modalidad en uso"
        footer={
          <div className="flex w-full justify-end gap-2 max-md:flex-col-reverse max-md:[&>button]:w-full">
            <Button variant="secondary" onClick={() => setEnUso(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={guardar} disabled={saving}>
              {saving ? "Guardando..." : "Desactivar"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-2 text-sm text-admin-ink">
          {enUso?.map((u) => (
            <p key={u.modalidad}>
              {u.clientes === 1 ? "1 cliente usa" : `${u.clientes} clientes usan`} «{MODALIDAD_LABEL[u.modalidad]}».
            </p>
          ))}
          <p className="text-admin-ink-soft">
            Conservarán esa modalidad y sus pedidos nuevos la seguirán usando. No podrás asignarla a otros clientes mientras esté
            inactiva, y verás un aviso en la ficha de cada uno para que la cambies.
          </p>
        </div>
      </Modal>
    </Card>
  );
}
