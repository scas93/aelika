"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/session-context";
import { useEsMovil } from "@/lib/use-es-movil";
import { ApiError, createUser, fetchUsers, updateUser, type Role, type TeamUser } from "@/lib/api";
import Card from "../../_components/Card";
import Button from "../../_components/Button";
import Modal from "../../_components/Modal";
import Badge from "../../_components/Badge";
import MenuAcciones from "../../_components/MenuAcciones";
import { ROLE_LABEL } from "@/lib/roles";
import { mensajeSinAcceso, puedeVerSubmodulo } from "../acceso";
import VolverAjustesLink from "../volver-link";
import { opcionesCambioRol, ordenarEquipo, puedeActuarSobre, rolesAsignables } from "./equipo-modelo";

export default function EquipoPage() {
  const { user, token } = useSession();

  return (
    <div className="flex flex-col gap-4">
      <VolverAjustesLink />
      {!puedeVerSubmodulo(user.rol, "/dashboard/ajustes/equipo") ? (
        <p className="text-sm text-admin-ink-soft">{mensajeSinAcceso(user.rol)}</p>
      ) : (
        <TeamManager currentUserId={user.id} rolActual={user.rol} token={token} />
      )}
    </div>
  );
}

type Dialogo =
  | { tipo: "alta" }
  | { tipo: "rol"; persona: TeamUser }
  | { tipo: "estado"; persona: TeamUser }
  | null;

function TeamManager({ currentUserId, rolActual, token }: { currentUserId: string; rolActual: Role; token: string }) {
  const esMovil = useEsMovil();
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [newPasswordFor, setNewPasswordFor] = useState<{ email: string; password: string } | null>(null);

  async function load() {
    try {
      setUsers(await fetchUsers(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el equipo");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ordenados = useMemo(() => (users ? ordenarEquipo(users) : null), [users]);

  // Los diálogos muestran sus propios errores: estas funciones lanzan si el backend rechaza y el diálogo sigue abierto.
  async function handleCreate(payload: { nombre: string; email: string; rol: Role }) {
    const created = await createUser(token, payload);
    setNewPasswordFor({ email: created.email, password: created.temporaryPassword });
    setDialogo(null);
    await load();
  }

  async function handleUpdate(id: string, patch: { rol?: Role; activo?: boolean }) {
    await updateUser(token, id, patch);
    setDialogo(null);
    await load();
  }

  const accionesDe = (persona: TeamUser) =>
    puedeActuarSobre(rolActual, currentUserId, persona)
      ? [
          { label: "Cambiar rol", onClick: () => setDialogo({ tipo: "rol", persona }) },
          { label: persona.activo ? "Desactivar" : "Reactivar", onClick: () => setDialogo({ tipo: "estado", persona }) },
        ]
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-admin-ink-soft">
          {ordenados === null ? "" : `${ordenados.length} ${ordenados.length === 1 ? "persona" : "personas"}`}
        </p>
        <Button variant="primary" size="barra" onClick={() => setDialogo({ tipo: "alta" })}>
          Agregar persona
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {ordenados === null ? (
        <p className="text-sm text-admin-ink-soft">Cargando...</p>
      ) : ordenados.length === 0 ? (
        <Card className="text-sm text-admin-ink-soft">Aún no tienes miembros en el equipo.</Card>
      ) : (
        <Card padding={0} className="overflow-hidden">
          <ul className="flex flex-col divide-y divide-admin-border">
            {ordenados.map((persona) => (
              <FilaPersona
                key={persona.id}
                persona={persona}
                esSelf={persona.id === currentUserId}
                acciones={accionesDe(persona)}
                esMovil={esMovil}
              />
            ))}
          </ul>
        </Card>
      )}

      <AltaModal
        open={dialogo?.tipo === "alta"}
        roles={rolesAsignables(rolActual)}
        onClose={() => setDialogo(null)}
        onCreate={handleCreate}
      />
      {dialogo?.tipo === "rol" && (
        <CambiarRolModal
          persona={dialogo.persona}
          opciones={opcionesCambioRol(rolActual, dialogo.persona)}
          onClose={() => setDialogo(null)}
          onConfirm={(rol) => handleUpdate(dialogo.persona.id, { rol })}
        />
      )}
      {dialogo?.tipo === "estado" && (
        <EstadoModal
          persona={dialogo.persona}
          onClose={() => setDialogo(null)}
          onConfirm={() => handleUpdate(dialogo.persona.id, { activo: !dialogo.persona.activo })}
        />
      )}

      <Modal
        open={newPasswordFor !== null}
        onClose={() => setNewPasswordFor(null)}
        title="Usuario creado"
        footer={
          <Button variant="primary" onClick={() => setNewPasswordFor(null)}>
            Entendido
          </Button>
        }
      >
        {newPasswordFor && <TemporaryPasswordBody email={newPasswordFor.email} password={newPasswordFor.password} />}
      </Modal>
    </div>
  );
}

function FilaPersona({
  persona,
  esSelf,
  acciones,
  esMovil,
}: {
  persona: TeamUser;
  esSelf: boolean;
  acciones: { label: string; onClick: () => void }[] | null;
  esMovil: boolean;
}) {
  const atenuado = persona.activo ? "" : "opacity-50";
  const menu = acciones ? <MenuAcciones acciones={acciones} label={`Acciones de ${persona.nombre}`} /> : null;
  const rol = <Badge variant="neutro">{ROLE_LABEL[persona.rol]}</Badge>;
  const inactivo = !persona.activo ? <Badge variant="neutro">Inactivo</Badge> : null;
  // «Tú» va junto al nombre (no en la zona de rol ni de acciones) para no empujar las columnas.
  const datos = (
    <div className={`flex min-w-0 flex-col ${atenuado}`}>
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-[15px] font-semibold text-admin-ink">{persona.nombre}</span>
        {esSelf && <span className="shrink-0 text-xs font-semibold text-admin-ink-soft">· Tú</span>}
      </span>
      <span className="truncate text-sm text-admin-ink-soft">{persona.email}</span>
    </div>
  );

  if (esMovil) {
    return (
      <li className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          {datos}
          {menu}
        </div>
        <div className={`flex flex-wrap items-center gap-2 ${atenuado}`}>
          {rol}
          {inactivo}
        </div>
      </li>
    );
  }
  // Columnas de ancho fijo: rol, estado y acciones quedan alineados entre filas tengan o no menú; la celda vacía no pinta nada.
  return (
    <li className="grid h-16 grid-cols-[minmax(0,1fr)_7rem_6rem_2rem] items-center gap-4 px-4 transition hover:bg-admin-bg">
      {datos}
      <div className={`flex items-center ${atenuado}`}>{rol}</div>
      <div className={`flex items-center ${atenuado}`}>{inactivo}</div>
      <div className="flex items-center justify-center">{menu}</div>
    </li>
  );
}

function AltaModal({
  open,
  roles,
  onClose,
  onCreate,
}: {
  open: boolean;
  roles: Role[];
  onClose: () => void;
  onCreate: (payload: { nombre: string; email: string; rol: Role }) => Promise<void>;
}) {
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<Role>("OPERADOR");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || !email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ nombre: nombre.trim(), email: email.trim(), rol });
      setNombre("");
      setEmail("");
      setRol("OPERADOR");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el usuario");
    } finally {
      setSubmitting(false);
    }
  }

  function cerrar() {
    setError(null);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={cerrar}
      title="Agregar persona"
      footer={
        <>
          <Button variant="secondary" onClick={cerrar}>
            Cancelar
          </Button>
          <Button type="submit" form="form-alta-persona" disabled={submitting || !nombre.trim() || !email.trim()}>
            Crear usuario
          </Button>
        </>
      }
    >
      <form id="form-alta-persona" onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ana Torres" className="admin-input" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Correo
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ana@negocio.com"
            className="admin-input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
          Rol
          <select value={rol} onChange={(e) => setRol(e.target.value as Role)} className="admin-input">
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}

function CambiarRolModal({
  persona,
  opciones,
  onClose,
  onConfirm,
}: {
  persona: TeamUser;
  opciones: Role[];
  onClose: () => void;
  onConfirm: (rol: Role) => Promise<void>;
}) {
  const [rol, setRol] = useState<Role>(opciones[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar() {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(rol);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar el rol");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Cambiar rol"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={submitting}>
            Confirmar cambio
          </Button>
        </>
      }
    >
      <p className="text-sm text-admin-ink-soft">
        Rol de <span className="font-bold text-admin-ink">{persona.nombre}</span>: hoy es {ROLE_LABEL[persona.rol]}.
      </p>
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
        Nuevo rol
        <select value={rol} onChange={(e) => setRol(e.target.value as Role)} className="admin-input">
          {opciones.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Modal>
  );
}

function EstadoModal({
  persona,
  onClose,
  onConfirm,
}: {
  persona: TeamUser;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desactivar = persona.activo;

  async function confirmar() {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el usuario");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={desactivar ? "Desactivar persona" : "Reactivar persona"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={desactivar ? "danger" : "primary"} onClick={confirmar} disabled={submitting}>
            {desactivar ? "Desactivar" : "Reactivar"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-admin-ink-soft">
        {desactivar ? (
          <>
            ¿Desactivar a <span className="font-bold text-admin-ink">{persona.nombre}</span>? Ya no podrá entrar al panel.
          </>
        ) : (
          <>
            ¿Reactivar a <span className="font-bold text-admin-ink">{persona.nombre}</span>? Podrá volver a entrar al panel.
          </>
        )}
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Modal>
  );
}

function TemporaryPasswordBody({ email, password }: { email: string; password: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(password);
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-admin-ink-soft">
        Comparte esta contraseña temporal con <span className="font-bold text-admin-ink">{email}</span>. No se
        volverá a mostrar — cuando el usuario entre por primera vez debe cambiarla.
      </p>
      <div className="flex items-center justify-between gap-2 rounded-[var(--radius-admin-control)] border border-admin-border px-3 h-barra font-mono text-sm text-admin-ink">
        {password}
        <Button variant="secondary" size="barra" onClick={handleCopy}>
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
    </div>
  );
}
