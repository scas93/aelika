"use client";

import { useEffect, useState } from "react";
import {
  ApiError,
  fetchDiasSinEntrega,
  marcarDiaSinEntrega,
  quitarDiaSinEntrega,
  type DiaSinEntrega,
  type MarcarDiaSinEntregaResultado,
} from "@/lib/api";
import Card from "../_components/Card";
import Button from "../_components/Button";

/** "vie 25 de dic de 2026" a partir de YYYY-MM-DD, sin desfase de zona. */
export function fechaLarga(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Hoy en Ciudad de México (YYYY-MM-DD): el mínimo del selector, para no ofrecer fechas pasadas. */
function hoyMexico(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Días sin entrega (festivos) del negocio de mayoreo: Admin y Gerente. Esas fechas no se pueden elegir en el portal del cliente
 * ni al crear o mover una entrega en el panel; no hay excepción desde el panel (para entregar ese día se quita de la lista).
 * Marcar una fecha no toca las entregas ya programadas: solo avisa cuáles y de qué clientes son.
 */
export default function DiasSinEntregaSection({ token }: { token: string }) {
  const [dias, setDias] = useState<DiaSinEntrega[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fecha, setFecha] = useState("");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<MarcarDiaSinEntregaResultado | null>(null);

  useEffect(() => {
    fetchDiasSinEntrega(token)
      .then(setDias)
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar la lista"));
  }, [token]);

  async function marcar(e: React.FormEvent) {
    e.preventDefault();
    if (!fecha) return;
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await marcarDiaSinEntrega(token, { fecha, ...(nota.trim() ? { nota: nota.trim() } : {}) });
      setDias((prev) => [...(prev ?? []), r.dia].sort((a, b) => a.fecha.localeCompare(b.fecha)));
      setAviso(r);
      setFecha("");
      setNota("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo marcar la fecha");
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(dia: DiaSinEntrega) {
    setError(null);
    setAviso(null);
    try {
      await quitarDiaSinEntrega(token, dia.id);
      setDias((prev) => (prev ?? []).filter((d) => d.id !== dia.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo quitar la fecha");
    }
  }

  const hoy = hoyMexico();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form onSubmit={marcar} className="flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-extrabold text-admin-ink">Días sin entrega</h2>
            <p className="text-sm text-admin-ink-soft">
              Fechas en las que no entregas (por ejemplo, festivos). Tus clientes no pueden elegirlas en su portal y el equipo
              tampoco puede crear ni mover una entrega a esas fechas. Si quieres entregar un día así, quítalo de la lista. Las
              entregas que ya estaban programadas no se modifican.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Fecha
              <input
                type="date"
                min={hoy}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="admin-input"
              />
            </label>
            <label className="flex min-w-[200px] flex-1 flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Nota (opcional)
              <input
                type="text"
                maxLength={100}
                placeholder="Navidad"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                className="admin-input"
              />
            </label>
            <Button type="submit" disabled={!fecha || guardando}>
              {guardando ? "Marcando..." : "Marcar sin entrega"}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-admin-red">
              {error}
            </p>
          )}
        </form>
      </Card>

      {aviso && (
        <Card>
          <div role="status" className="flex flex-col gap-2 text-sm">
            <p className="font-semibold text-admin-ink">Marcaste el {fechaLarga(aviso.dia.fecha)} como día sin entrega.</p>
            {aviso.afectadas.total === 0 ? (
              <p className="text-admin-ink-soft">No hay entregas programadas ese día.</p>
            ) : (
              <>
                <p className="text-admin-ink">
                  Hay {aviso.afectadas.total} {aviso.afectadas.total === 1 ? "entrega programada" : "entregas programadas"} ese
                  día. No se modificaron ni se cancelaron: resuélvelas con tu equipo y tus clientes.
                </p>
                <ul className="flex flex-col gap-0.5 text-admin-ink-soft">
                  {aviso.afectadas.entregas.map((en, i) => (
                    <li key={`${en.folio}-${i}`}>
                      {en.cliente} · pedido {en.folio}
                      {en.pagado ? " (pagado)" : ""}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </Card>
      )}

      <Card>
        {dias === null ? (
          <p className="text-sm text-admin-ink-soft">{error ? "" : "Cargando..."}</p>
        ) : dias.length === 0 ? (
          <p className="text-sm text-admin-ink-soft">Aún no hay días sin entrega.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-admin-border">
            {dias.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className={`flex flex-col text-sm ${d.fecha < hoy ? "text-admin-ink-soft" : "text-admin-ink"}`}>
                  <span className="font-semibold">{fechaLarga(d.fecha)}</span>
                  {d.nota && <span className="text-xs text-admin-ink-soft">{d.nota}</span>}
                </span>
                <Button type="button" variant="secondary" size="tabla" onClick={() => quitar(d)} aria-label={`Quitar ${fechaLarga(d.fecha)}`}>
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
