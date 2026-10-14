"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  agregarTelefonoClienteB2b,
  bajaClienteB2b,
  cambiarPrincipalClienteB2b,
  fetchClienteB2b,
  quitarTelefonoClienteB2b,
  reactivarClienteB2b,
  updateClienteB2b,
  type ClienteB2bDetalle,
  type ModalidadPagoB2b,
} from "@/lib/api";
import { formatTelefono } from "@/lib/format";
import { descuentoValido, MODALIDAD_LABEL, parseDescuento } from "./cliente-b2b-form";
import SidePanel from "../_components/SidePanel";
import Modal from "../_components/Modal";
import Button from "../_components/Button";
import Badge from "../_components/Badge";

const textoDescuento = (d: number | null) => (d === null ? "" : String(d));

/** Detalle y edición de un cliente de mayoreo (panel lateral): datos, teléfonos autorizados, baja y reactivación. */
export default function ClienteB2bPanel({
  clienteId,
  onClose,
  onChanged,
}: {
  clienteId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { token } = useSession();

  const [cliente, setCliente] = useState<ClienteB2bDetalle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [direccion, setDireccion] = useState("");
  const [descuento, setDescuento] = useState("");
  const [modalidad, setModalidad] = useState<"" | ModalidadPagoB2b>("");
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nuevoTelefono, setNuevoTelefono] = useState("");
  const [nuevoContacto, setNuevoContacto] = useState("");
  const [nuevoPrincipal, setNuevoPrincipal] = useState(false);
  const [telefonoMsg, setTelefonoMsg] = useState<{ id: string; texto: string } | null>(null);
  const [telefonoError, setTelefonoError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const [confirmar, setConfirmar] = useState<"baja" | "reactivar" | null>(null);

  function aplicar(c: ClienteB2bDetalle) {
    setCliente(c);
    setNombre(c.nombre);
    setDireccion(c.direccion ?? "");
    setDescuento(textoDescuento(c.descuentoPorcentaje));
    setModalidad(c.modalidadPago ?? "");
  }

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reinicia el panel al cambiar de cliente seleccionado */
    setCliente(null);
    setLoadError(null);
    setError(null);
    setGuardado(false);
    setTelefonoMsg(null);
    setTelefonoError(null);
    setNuevoTelefono("");
    setNuevoContacto("");
    setNuevoPrincipal(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (!clienteId) return;
    let cancelled = false;
    fetchClienteB2b(token, clienteId)
      .then((c) => {
        if (!cancelled) aplicar(c);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof ApiError ? err.message : "No se pudo cargar el cliente");
      });
    return () => {
      cancelled = true;
    };
  }, [clienteId, token]);

  const descuentoNum = parseDescuento(descuento);
  const descuentoCambio = cliente !== null && (descuentoNum ?? null) !== (cliente.descuentoPorcentaje ?? null);
  const hayCambios =
    cliente !== null &&
    (nombre.trim() !== cliente.nombre ||
      direccion.trim() !== (cliente.direccion ?? "") ||
      descuentoCambio ||
      (modalidad || null) !== (cliente.modalidadPago ?? null));
  const puedeGuardar = hayCambios && nombre.trim().length >= 2 && direccion.trim().length >= 3 && descuentoValido(descuentoNum) && !guardando;

  async function handleGuardar() {
    if (!cliente) return;
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      const c = await updateClienteB2b(token, cliente.id, {
        nombre: nombre.trim(),
        direccion: direccion.trim(),
        descuentoPorcentaje: descuentoNum && descuentoNum > 0 ? descuentoNum : null,
        modalidadPago: modalidad || null,
      });
      aplicar(c);
      setGuardado(true);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron guardar los cambios");
    } finally {
      setGuardando(false);
    }
  }

  // Cada operación de teléfonos devuelve el cliente completo y actualizado.
  async function operarTelefono(fn: () => Promise<ClienteB2bDetalle>) {
    setTrabajando(true);
    setTelefonoError(null);
    setTelefonoMsg(null);
    try {
      const c = await fn();
      // Solo se refresca la lista de teléfonos: lo que el usuario esté editando en los datos del cliente no se pisa.
      setCliente((prev) => (prev ? { ...prev, telefonos: c.telefonos } : c));
      onChanged();
      return true;
    } catch (err) {
      setTelefonoError(err instanceof ApiError ? err.message : "No se pudo actualizar el teléfono");
      return false;
    } finally {
      setTrabajando(false);
    }
  }

  async function handleAgregarTelefono() {
    if (!cliente) return;
    const ok = await operarTelefono(() =>
      agregarTelefonoClienteB2b(token, cliente.id, {
        telefono: nuevoTelefono.trim(),
        nombreContacto: nuevoContacto.trim() || undefined,
        principal: nuevoPrincipal || undefined,
      }),
    );
    if (ok) {
      setNuevoTelefono("");
      setNuevoContacto("");
      setNuevoPrincipal(false);
    }
  }

  function handleQuitar(id: string, principal: boolean) {
    if (!cliente) return;
    // Mensajes claros ANTES de llamar al servidor (que igual lo rechazaría con 409).
    if (cliente.telefonos.length <= 1) {
      setTelefonoMsg({ id, texto: "Es el único teléfono: el cliente necesita al menos uno. Agrega otro antes de quitarlo." });
      return;
    }
    if (principal) {
      setTelefonoMsg({ id, texto: "Es el teléfono principal: marca otro como principal antes de quitarlo." });
      return;
    }
    operarTelefono(() => quitarTelefonoClienteB2b(token, cliente.id, id));
  }

  async function handleConfirmar() {
    if (!cliente || !confirmar) return;
    setTrabajando(true);
    setError(null);
    try {
      const c = confirmar === "baja" ? await bajaClienteB2b(token, cliente.id) : await reactivarClienteB2b(token, cliente.id);
      setCliente((prev) => (prev ? { ...prev, activo: c.activo, bajaAt: c.bajaAt } : c));
      setConfirmar(null);
      onChanged();
    } catch (err) {
      setConfirmar(null);
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el cliente");
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <SidePanel open={clienteId !== null} onClose={onClose} title={cliente ? cliente.nombre : "Cliente"}>
      {loadError && <p className="text-sm text-red-600">{loadError}</p>}
      {!cliente && !loadError && <p className="text-sm text-admin-ink-soft">Cargando...</p>}

      {cliente && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={cliente.activo ? "exito" : "neutro"}>{cliente.activo ? "Activo" : "De baja"}</Badge>
            {cliente.incompleto && <Badge variant="advertencia">Incompleto</Badge>}
            <span className="text-sm text-admin-ink-soft">
              {cliente.pedidosActivos} pedido{cliente.pedidosActivos === 1 ? "" : "s"} activo{cliente.pedidosActivos === 1 ? "" : "s"}
            </span>
          </div>

          {cliente.incompleto && (
            <p className="rounded-[var(--radius-admin-control)] bg-amber-50 p-2 text-xs text-amber-800">
              A este cliente le falta la dirección. Agrégala abajo para completar su ficha.
            </p>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-admin-ink">Código del cliente</span>
              <span className="rounded-[var(--radius-admin-control)] bg-admin-bg px-3 py-2 text-sm text-admin-ink">{cliente.codigo ?? "—"}</span>
              <span className="text-xs text-admin-ink-soft">El código no se puede cambiar.</span>
            </div>

            <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Nombre comercial
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="admin-input" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Dirección
              <input value={direccion} onChange={(e) => setDireccion(e.target.value)} className="admin-input" placeholder="Calle, número, colonia, ciudad" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
                Descuento %
                <input value={descuento} onChange={(e) => setDescuento(e.target.value)} inputMode="decimal" className="admin-input" placeholder="Sin descuento" />
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
            {descuentoCambio && <p className="text-xs font-semibold text-amber-800">No afecta pedidos ya creados.</p>}

            {error && <p className="text-sm text-red-600">{error}</p>}
            {guardado && !hayCambios && <p className="text-sm text-admin-green-dark">Cambios guardados.</p>}
            <div>
              <Button variant="primary" onClick={handleGuardar} disabled={!puedeGuardar}>
                {guardando ? "Guardando..." : "Guardar cambios"}
              </Button>
            </div>
          </div>

          {/* Teléfonos autorizados */}
          <div className="flex flex-col gap-3 border-t border-admin-border pt-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold text-admin-ink">Teléfonos autorizados</span>
              <span className="text-xs text-admin-ink-soft">El principal recibe las notificaciones. Siempre hay al menos uno y exactamente un principal.</span>
            </div>
            <ul className="flex flex-col gap-2">
              {cliente.telefonos.map((t) => (
                <li key={t.id} className="flex flex-col gap-1 rounded-[var(--radius-admin-control)] border border-admin-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-admin-ink">{formatTelefono(t.telefono)}</span>
                      {t.nombreContacto && <span className="text-xs text-admin-ink-soft">{t.nombreContacto}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {t.principal ? (
                        <Badge variant="acento">Principal</Badge>
                      ) : (
                        <button
                          type="button"
                          disabled={trabajando}
                          onClick={() => operarTelefono(() => cambiarPrincipalClienteB2b(token, cliente.id, t.id))}
                          className="text-xs font-semibold text-mayoreo-accent hover:underline disabled:opacity-40"
                        >
                          Hacer principal
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={trabajando}
                        onClick={() => handleQuitar(t.id, t.principal)}
                        className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-40"
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                  {telefonoMsg?.id === t.id && (
                    <p role="alert" className="text-xs font-semibold text-amber-800">
                      {telefonoMsg.texto}
                    </p>
                  )}
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-2 rounded-[var(--radius-admin-control)] bg-admin-bg p-3">
              <span className="text-sm font-semibold text-admin-ink">Agregar teléfono</span>
              <div className="flex gap-2">
                <input
                  value={nuevoTelefono}
                  onChange={(e) => setNuevoTelefono(e.target.value)}
                  inputMode="tel"
                  className="admin-input min-w-0 flex-1"
                  placeholder="10 dígitos"
                  aria-label="Nuevo teléfono"
                />
                <input
                  value={nuevoContacto}
                  onChange={(e) => setNuevoContacto(e.target.value)}
                  className="admin-input min-w-0 flex-1"
                  placeholder="Contacto (opcional)"
                  aria-label="Contacto del nuevo teléfono"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-admin-ink">
                <input type="checkbox" checked={nuevoPrincipal} onChange={(e) => setNuevoPrincipal(e.target.checked)} />
                Marcar como principal
              </label>
              <div>
                <Button variant="secondary" size="sm" onClick={handleAgregarTelefono} disabled={trabajando || nuevoTelefono.replace(/\D/g, "").length < 10}>
                  Agregar
                </Button>
              </div>
            </div>
            {telefonoError && <p className="text-sm text-red-600">{telefonoError}</p>}
          </div>

          {/* Baja / reactivación */}
          <div className="flex flex-col gap-2 border-t border-admin-border pt-4">
            {cliente.activo ? (
              <>
                <p className="text-xs text-admin-ink-soft">
                  Al dar de baja, el cliente ya no podrá pedir ni entrar. Sus pedidos activos siguen y su historial se conserva.
                </p>
                <div>
                  <Button variant="danger" onClick={() => setConfirmar("baja")} disabled={trabajando}>
                    Dar de baja
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-admin-ink-soft">Este cliente está de baja: no puede pedir ni entrar. Puedes reactivarlo cuando quieras.</p>
                <div>
                  <Button variant="primary" onClick={() => setConfirmar("reactivar")} disabled={trabajando}>
                    Reactivar
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <Modal
        open={confirmar !== null}
        onClose={() => {
          if (!trabajando) setConfirmar(null);
        }}
        title={confirmar === "baja" ? "¿Dar de baja a este cliente?" : "¿Reactivar a este cliente?"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmar(null)} disabled={trabajando}>
              Volver
            </Button>
            <Button variant={confirmar === "baja" ? "danger" : "primary"} onClick={handleConfirmar} disabled={trabajando}>
              {trabajando ? "Guardando..." : confirmar === "baja" ? "Sí, dar de baja" : "Sí, reactivar"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-admin-ink">
          {confirmar === "baja"
            ? `${cliente?.nombre} ya no podrá pedir ni entrar. Sus pedidos activos siguen hasta completarse y su historial se conserva.`
            : `${cliente?.nombre} volverá a poder pedir y entrar.`}
        </p>
      </Modal>
    </SidePanel>
  );
}
