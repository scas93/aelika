"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, createClienteB2b, fetchClientesB2b, type ClienteB2bDetalle, type ModalidadPagoB2b } from "@/lib/api";
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

// El sufijo se normaliza igual que en el servidor: minúsculas, sin espacios ni acentos, solo letras, números y guiones.
function slugificar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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
  const { token, user } = useSession();
  const prefijo = `${user.tenant.slug}-`;

  const [nombre, setNombre] = useState("");
  const [sufijo, setSufijo] = useState("");
  const [sufijoEditado, setSufijoEditado] = useState(false);
  const [direccion, setDireccion] = useState("");
  const [descuento, setDescuento] = useState("");
  const [modalidad, setModalidad] = useState<"" | ModalidadPagoB2b>("");
  const [telefonos, setTelefonos] = useState<TelefonoForm[]>([{ key: 1, telefono: "", nombreContacto: "" }]);
  const [principal, setPrincipal] = useState(1);
  const [siguienteKey, setSiguienteKey] = useState(2);
  const [codigoExiste, setCodigoExiste] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- reinicia el formulario cada vez que se abre */
    setNombre("");
    setSufijo("");
    setSufijoEditado(false);
    setDireccion("");
    setDescuento("");
    setModalidad("");
    setTelefonos([{ key: 1, telefono: "", nombreContacto: "" }]);
    setPrincipal(1);
    setSiguienteKey(2);
    setCodigoExiste(false);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open]);

  const sufijoLimpio = slugificar(sufijo);
  const codigo = `${prefijo}${sufijoLimpio}`;

  // Aviso de código repetido mientras se escribe (el servidor igual lo rechaza con 409 al guardar).
  useEffect(() => {
    if (!open || !sufijoLimpio) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sin sufijo no hay nada que comprobar
      setCodigoExiste(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      fetchClientesB2b(token, { q: codigo, estado: "TODOS", limit: 10 })
        .then((res) => {
          if (!cancelled) setCodigoExiste(res.data.some((c) => c.codigo === codigo));
        })
        .catch(() => {});
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, token, codigo, sufijoLimpio]);

  function onNombreChange(valor: string) {
    setNombre(valor);
    // Mientras no se haya tocado el código a mano, se sugiere a partir del nombre.
    if (!sufijoEditado) setSufijo(slugificar(valor));
  }

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
  const telefonosValidos = telefonosLlenos.length > 0 && telefonosLlenos.every((t) => t.telefono.replace(/\D/g, "").length >= 10);
  const puedeGuardar =
    nombre.trim().length >= 2 &&
    sufijoLimpio.length > 0 &&
    direccion.trim().length >= 3 &&
    descuentoValido(descuentoNum) &&
    telefonosValidos &&
    !codigoExiste &&
    !guardando;

  async function handleGuardar() {
    setGuardando(true);
    setError(null);
    try {
      // Si el principal quedó en una fila vacía (que no se envía), el primero con número lo es.
      const principalKey = telefonosLlenos.some((t) => t.key === principal) ? principal : telefonosLlenos[0].key;
      const creado = await createClienteB2b(token, {
        nombre: nombre.trim(),
        sufijo: sufijoLimpio,
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
      setError(err instanceof ApiError ? err.message : "No se pudo dar de alta al cliente");
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
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleGuardar} disabled={!puedeGuardar}>
            {guardando ? "Guardando..." : "Dar de alta"}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Nombre comercial
          <input value={nombre} onChange={(e) => onNombreChange(e.target.value)} className="admin-input" placeholder="Ej. Café Aurora Matriz" />
        </label>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="cliente-sufijo" className="text-sm font-semibold text-admin-ink">
            Código del cliente
          </label>
          <div className="flex items-stretch">
            <span className="flex items-center rounded-l-[var(--radius-admin-control)] border border-r-0 border-admin-border bg-admin-bg px-3 text-sm text-admin-ink-soft">
              {prefijo}
            </span>
            <input
              id="cliente-sufijo"
              value={sufijo}
              onChange={(e) => {
                setSufijo(e.target.value);
                setSufijoEditado(true);
              }}
              className="admin-input min-w-0 flex-1 rounded-l-none"
              placeholder="matriz"
            />
          </div>
          {codigoExiste ? (
            <p role="alert" className="text-xs font-semibold text-red-600">
              Ya existe un cliente con el código {codigo}. Elige otro.
            </p>
          ) : (
            <p className="text-xs text-admin-ink-soft">
              Quedará como <span className="font-semibold">{codigo}</span>. <span className="font-semibold">No se podrá cambiar después.</span>
            </p>
          )}
        </div>

        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Dirección
          <input value={direccion} onChange={(e) => setDireccion(e.target.value)} className="admin-input" placeholder="Calle, número, colonia, ciudad" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
            Descuento % (opcional)
            <input
              value={descuento}
              onChange={(e) => setDescuento(e.target.value)}
              inputMode="decimal"
              className="admin-input"
              placeholder="Ej. 10"
            />
            {!descuentoValido(descuentoNum) && <span className="text-xs font-normal text-red-600">Escribe un número entre 0 y 100.</span>}
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
            Modalidad de pago
            <select value={modalidad} onChange={(e) => setModalidad(e.target.value as "" | ModalidadPagoB2b)} className="admin-input">
              <option value="">La del negocio</option>
              <option value="AL_INICIO">{MODALIDAD_LABEL.AL_INICIO}</option>
              <option value="AL_FINAL">{MODALIDAD_LABEL.AL_FINAL}</option>
            </select>
          </label>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold text-admin-ink">Teléfonos autorizados</legend>
          <p className="text-xs text-admin-ink-soft">Al menos uno. El principal es donde llegan las notificaciones.</p>
          {telefonos.map((t, i) => (
            <div key={t.key} className="flex items-center gap-2">
              <input
                type="radio"
                name="telefono-principal"
                checked={principal === t.key}
                onChange={() => setPrincipal(t.key)}
                aria-label={`Teléfono ${i + 1} como principal`}
                title="Principal"
              />
              <input
                value={t.telefono}
                onChange={(e) => setTelefonos((prev) => prev.map((x) => (x.key === t.key ? { ...x, telefono: e.target.value } : x)))}
                inputMode="tel"
                className="admin-input min-w-0 flex-1"
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
          ))}
          <div>
            <button type="button" onClick={agregarTelefono} className="text-sm font-semibold text-mayoreo-accent hover:underline">
              + Agregar teléfono
            </button>
          </div>
          {telefonosLlenos.length > 0 && !telefonosValidos && (
            <p className="text-xs text-red-600">Cada teléfono debe tener 10 dígitos.</p>
          )}
        </fieldset>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}
