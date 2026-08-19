"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session-context";
import {
  ApiError,
  createUser,
  fetchUsers,
  updateUser,
  type Role,
  type TeamUser,
} from "@/lib/api";

const ROLES: Role[] = ["OPERADOR", "GERENTE", "DUENO"];
const ROLE_LABEL: Record<Role, string> = {
  OPERADOR: "Operador",
  GERENTE: "Gerente",
  DUENO: "Dueño",
};

const CARD = "rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]";
const BTN_PRIMARY =
  "self-start rounded-lg bg-admin-green px-4 py-2 text-sm font-bold text-white transition hover:bg-admin-green-dark disabled:cursor-not-allowed disabled:opacity-40";
const BTN_SECONDARY =
  "rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-bold text-admin-ink/70 transition hover:bg-admin-bg disabled:cursor-not-allowed disabled:opacity-40";

export default function EquipoPage() {
  const { user, token } = useSession();

  if (user.rol !== "DUENO") {
    return <p className="text-sm text-admin-ink/55">Solo el dueño del negocio puede administrar el equipo.</p>;
  }

  return <TeamManager currentUserId={user.id} token={token} />;
}

function TeamManager({ currentUserId, token }: { currentUserId: string; token: string }) {
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newPasswordFor, setNewPasswordFor] = useState<{ email: string; password: string } | null>(null);

  async function load() {
    try {
      const data = await fetchUsers(token);
      setUsers(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el equipo");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(payload: { nombre: string; email: string; rol: Role }) {
    const created = await createUser(token, payload);
    setNewPasswordFor({ email: created.email, password: created.temporaryPassword });
    await load();
  }

  async function handleUpdate(id: string, patch: { rol?: Role; activo?: boolean }) {
    setError(null);
    try {
      await updateUser(token, id, patch);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo actualizar el usuario");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {users === null ? (
        <p className="text-sm text-admin-ink/55">Cargando...</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {users.map((teamUser) => {
            const isSelf = teamUser.id === currentUserId;
            return (
              <li key={teamUser.id} className={`${CARD} flex items-center justify-between gap-3 p-3`}>
                <div className="flex flex-col">
                  <span className={teamUser.activo ? "font-bold text-admin-ink" : "font-bold text-admin-ink/40"}>
                    {teamUser.nombre} {isSelf && <span className="text-admin-ink/40">(tú)</span>}
                  </span>
                  <span className="text-sm text-admin-ink/55">{teamUser.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  {!teamUser.activo && (
                    <span className="rounded-full bg-admin-bg px-2 py-0.5 text-xs font-medium text-admin-ink/55">
                      Inactivo
                    </span>
                  )}
                  <select
                    value={teamUser.rol}
                    disabled={isSelf}
                    onChange={(e) => handleUpdate(teamUser.id, { rol: e.target.value as Role })}
                    className="input py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {ROLES.map((rol) => (
                      <option key={rol} value={rol}>
                        {ROLE_LABEL[rol]}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={isSelf}
                    onClick={() => handleUpdate(teamUser.id, { activo: !teamUser.activo })}
                    className={BTN_SECONDARY}
                  >
                    {teamUser.activo ? "Desactivar" : "Activar"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <NewUserForm onCreate={handleCreate} />

      {newPasswordFor && (
        <TemporaryPasswordModal
          email={newPasswordFor.email}
          password={newPasswordFor.password}
          onClose={() => setNewPasswordFor(null)}
        />
      )}
    </div>
  );
}

function NewUserForm({
  onCreate,
}: {
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

  return (
    <form onSubmit={handleSubmit} className={`${CARD} flex flex-col gap-3 p-4`}>
      <p className="text-sm font-extrabold text-admin-ink">Agregar a alguien del equipo</p>
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
          Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ana Torres" className="input" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
          Correo
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ana@negocio.com"
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
          Rol
          <select value={rol} onChange={(e) => setRol(e.target.value as Role)} className="input">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" disabled={submitting || !nombre.trim() || !email.trim()} className={BTN_PRIMARY}>
        Crear usuario
      </button>
    </form>
  );
}

function TemporaryPasswordModal({
  email,
  password,
  onClose,
}: {
  email: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(password);
    setCopied(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-[14px] bg-white p-6 shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
        <h2 className="text-lg font-extrabold text-admin-ink">Usuario creado</h2>
        <p className="text-sm text-admin-ink/55">
          Comparte esta contraseña temporal con <span className="font-bold text-admin-ink">{email}</span>. No se
          volverá a mostrar — cuando el usuario entre por primera vez debe cambiarla.
        </p>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-black/10 px-3 py-2.5 font-mono text-sm text-admin-ink">
          {password}
          <button onClick={handleCopy} className={BTN_SECONDARY}>
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
        <button onClick={onClose} className={`${BTN_PRIMARY} self-end`}>
          Entendido
        </button>
      </div>
    </div>
  );
}
