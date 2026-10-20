"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, createClienteB2b, fetchClientesB2bConfig, type ClienteB2bDetalle, type ModalidadPagoB2b } from "@/lib/api";
import Modal from "../_components/Modal";
import Button from "../_components/Button";

interface TelefonoForm {
  key: number;
  telefono: string;
  nombreContacto: string;
}

export const MODALIDAD_LABEL: Record<ModalidadPagoB2b, string> = {
  AL_INICIO: "Al confirmar el pedido (por adelantado)",
  AL_FINAL: "Al finalizar la semana (crédito)",
};

/** Convierte lo escrito en el campo de descuento a número (vacío = sin descuento). NaN si no es un número. */
export function parseDescuento(texto: string): number | null {
  const limpio = texto.trim().replace(",", ".");
  if (limpio === "") return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function descuentoValido(valor: number | null): boolean {
  return valor === null || (!Number.isNaN(valor) && valor >= 0 && valor <= 100);
}

export const MODALIDAD_CORTA: Record<ModalidadPagoB2b, string> = {
  AL_INICIO: "Al inicio",
  AL_FINAL: "Al final",
};

/** Texto de la opción por defecto del selector de modalidad: muestra el valor real del negocio. */
export function etiquetaModalidadNegocio(modalidadNegocio: ModalidadPagoB2b | null): string {
  return modalidadNegocio ? `Igual que el negocio (${MODALIDAD_CORTA[modalidadNegocio]})` : "Igual que el negocio";
}

type Errores = { nombre?: string; direccion?: string; descuento?: string; telefonos?: string; filas: Record<number, string> };

const CAMPO_ERROR = (mensaje?: string) => (mensaje ? "border-red-500!" : "");

/** Alta de un cliente de mayoreo (modal). */
export default function ClienteB2bAltaModal({
  open,
  onClose,
  onCreado,
}: {
  open: boolean;
  onClose: () => void;
  onCreado: (cliente: ClienteB2bDetalle) => void;
}) {
  const { token } = useSession();

  const [nombre, setNombre] = useState("");
  const [direccion, setDireccion] = useState("");
  const [descuento, setDescuento] = useState("");
  const [modalidad, setModalidad] = useState<"" | ModalidadPagoB2b>("");
  const [modalidadNegocio, setModalidadNegocio] = useState<ModalidadPagoB2b | null>(null);
  const [telefonos, setTelefonos] = useState<TelefonoForm[]>([{ key: 1, telefono: "", nombreContacto: "" }]);
  const [principal, setPrincipal] = useState(1);
  const [siguienteKey, setSiguienteKey] = useState(2);
  const [errores, setErrores] = useState<Errores>({ filas: {} });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reinicia el formulario cada vez que se abre */
    setNombre("");
    setDireccion("");
    setDescuento("");
    setModalidad("");
    setTelefonos([{ key: 1, telefono: "", nombreContacto: "" }]);
    setPrincipal(1);
    setSiguienteKey(2);
    setErrores({ filas: {} });
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    let cancelled = false;
    fetchClientesB2bConfig(token)
      .then((c) => !cancelled && setModalidadNegocio(c.modalidadCobroNegocio))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, token]);

  function agregarTelefono() {
    setTelefonos((prev) => [...prev, { key: siguienteKey, telefono: "", nombreContacto: "" }]);
    setSiguienteKey((k) => k + 1);
  }

  function quitarTelefono(key: number) {
    setTelefonos((prev) => {
      const resto = prev.filter((t) => t.key !== key);
      if (key === principal && resto.length > 0) setPrincipal(resto[0].key); // el principal se reasigna al primero
      return resto;
    });
  }

  const descuentoNum = parseDescuento(descuento);
  const telefonosLlenos = telefonos.filter((t) => t.telefono.trim() !== "");

  // «Crear cliente» siempre está activo: al presionarlo con datos faltantes se marcan los campos con su mensaje y no se envía.
  function validar(): Errores {
    const e: Errores = { filas: {} };
    if (nombre.trim().length < 2) e.nombre = "Escribe el nombre comercial.";
    if (direccion.trim().length < 3) e.direccion = "Escribe la dirección.";
    if (!descuentoValido(descuentoNum)) e.descuento = "Escribe un número entre 0 y 100.";
    if (telefonosLlenos.length === 0) e.telefonos = "Agrega al menos un teléfono.";
    for (const t of telefonosLlenos) {
      if (t.telefono.replace(/\D/g, "").length < 10) e.filas[t.key] = "Debe tener 10 dígitos.";
    }
    return e;
  }

  async function handleGuardar() {
    const e = validar();
    setErrores(e);
    if (e.nombre || e.direccion || e.descuento || e.telefonos || Object.keys(e.filas).length > 0) return;
    setGuardando(true);
    setError(null);
    try {
      // Si el principal quedó en una fila vacía (que no se envía), el primero con número lo es.
      const principalKey = telefonosLlenos.some((t) => t.key === principal) ? principal : telefonosLlenos[0].key;
      const creado = await createClienteB2b(token, {
        nombre: nombre.trim(),
        direccion: direccion.trim(),
        descuentoPorcentaje: descuentoNum && descuentoNum > 0 ? descuentoNum : undefined,
        modalidadPago: modalidad || undefined,
        telefonos: telefonosLlenos.map((t) => ({
          telefono: t.telefono.trim(),
          principal: t.key === principalKey,
          nombreContacto: t.nombreContacto.trim() || undefined,
        })),
      });
      onCreado(creado);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear al cliente");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!guardando) onClose();
      }}
      title="Nuevo cliente"
      wide
      footer={
        <div className="flex w-full justify-end gap-2 max-md:flex-col-reverse max-md:[&>button]:w-full">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleGuardar} disabled={guardando}>
            {guardando ? "Guardando..." : "Crear cliente"}
          </Button>
        </div>
      }
    >
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Nombre comercial
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className={`admin-input ${CAMPO_ERROR(errores.nombre)}`}
            aria-invalid={!!errores.nombre}
            placeholder="Ej. Café Aurora Matriz"
          />
          {errores.nombre && <span className="text-xs font-normal text-red-600">{errores.nombre}</span>}
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Dirección
          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            className={`admin-input ${CAMPO_ERROR(errores.direccion)}`}
            aria-invalid={!!errores.direccion}
            placeholder="Calle, número, colonia, ciudad"
          />
          {errores.direccion && <span className="text-xs font-normal text-red-600">{errores.direccion}</span>}
        </label>

        <div className="grid grid-cols-[1fr_1.5fr] gap-3 max-md:grid-cols-1">
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-admin-ink">
            Descuento % (opcional)
            <input
              value={descuento}
              onChange={(e) => setDescuento(e.target.value)}
              inputMode="decimal"
              className={`admin-input ${CAMPO_ERROR(errores.descuento)}`}
              aria-invalid={!!errores.descuento}
              placeholder="Ej. 10"
            />
            {errores.descuento && <span className="text-xs font-normal text-red-600">{errores.descuento}</span>}
          </label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold text-admin-ink">
            Modalidad de pago
            <select value={modalidad} onChange={(e) => setModalidad(e.target.value as "" | ModalidadPagoB2b)} className="admin-input w-full min-w-0">
              <option value="">{etiquetaModalidadNegocio(modalidadNegocio)}</option>
              <option value="AL_INICIO">{MODALIDAD_LABEL.AL_INICIO}</option>
              <option value="AL_FINAL">{MODALIDAD_LABEL.AL_FINAL}</option>
            </select>
          </label>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold text-admin-ink">Teléfonos autorizados</legend>
          <p className="text-xs text-admin-ink-soft">Al menos uno. El principal es donde llegan las notificaciones.</p>
          {telefonos.map((t, i) => (
            <div key={t.key} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <label className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-admin-ink">
                  <input
                    type="radio"
                    name="telefono-principal"
                    checked={principal === t.key}
                    onChange={() => setPrincipal(t.key)}
                    aria-label={`Teléfono ${i + 1} como principal`}
                  />
                  Principal
                </label>
                <input
                  value={t.telefono}
                  onChange={(e) => setTelefonos((prev) => prev.map((x) => (x.key === t.key ? { ...x, telefono: e.target.value } : x)))}
                  inputMode="tel"
                  className={`admin-input min-w-0 flex-1 ${CAMPO_ERROR(errores.filas[t.key])}`}
                  aria-invalid={!!errores.filas[t.key]}
                  placeholder="10 dígitos"
                  aria-label={`Teléfono ${i + 1}`}
                />
                <input
                  value={t.nombreContacto}
                  onChange={(e) => setTelefonos((prev) => prev.map((x) => (x.key === t.key ? { ...x, nombreContacto: e.target.value } : x)))}
                  className="admin-input min-w-0 flex-1"
                  placeholder="Contacto (opcional)"
                  aria-label={`Contacto del teléfono ${i + 1}`}
                />
                {telefonos.length > 1 && (
                  <button type="button" onClick={() => quitarTelefono(t.key)} className="text-xs font-semibold text-red-600 hover:underline">
                    Quitar
                  </button>
                )}
              </div>
              {errores.filas[t.key] && <span className="text-xs text-red-600">{errores.filas[t.key]}</span>}
            </div>
          ))}
          <div>
            <Button variant="secondary" size="tabla" onClick={agregarTelefono}>
              + Agregar teléfono
            </Button>
          </div>
          {errores.telefonos && <p className="text-xs text-red-600">{errores.telefonos}</p>}
        </fieldset>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
