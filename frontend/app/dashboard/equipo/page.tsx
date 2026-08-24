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
import Card from "../_components/Card";
import Button from "../_components/Button";
import Modal from "../_components/Modal";

const ROLES: Role[] = ["OPERADOR", "GERENTE", "DUENO"];
const ROLE_LABEL: Record<Role, string> = {
  OPERADOR: "Operador",
  GERENTE: "Gerente",
  DUENO: "Dueño",
};

export default function EquipoPage() {
  const { user, token } = useSession();

  if (user.rol !== "DUENO") {
    return <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede administrar el equipo.</p>;
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
        <p className="text-sm text-admin-ink-soft">Cargando...</p>
      ) : users.length === 0 ? (
        <Card className="text-sm text-admin-ink-soft">Aún no tienes miembros en el equipo.</Card>
      ) : (
        <Card padding={0} className="overflow-hidden">
          <ul className="flex flex-col divide-y divide-admin-border">
            {users.map((teamUser) => {
              const isSelf = teamUser.id === currentUserId;
              return (
                <li
                  key={teamUser.id}
                  className="flex h-16 items-center justify-between gap-3 px-4 transition hover:bg-admin-bg"
                >
                  <div className="flex flex-col">
                    <span
                      className={
                        teamUser.activo
                          ? "text-[15px] font-semibold text-admin-ink"
                          : "text-[15px] font-semibold text-admin-ink/40"
                      }
                    >
                      {teamUser.nombre} {isSelf && <span className="text-admin-ink-soft">(tú)</span>}
                    </span>
                    <span className="text-sm text-admin-ink-soft">{teamUser.email}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!teamUser.activo && (
                      <span className="rounded-full bg-admin-bg px-2 py-0.5 text-xs font-medium text-admin-ink-soft">
                        Inactivo
                      </span>
                    )}
                    <select
                      value={teamUser.rol}
                      disabled={isSelf}
                      onChange={(e) => handleUpdate(teamUser.id, { rol: e.target.value as Role })}
                      className="admin-input py-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {ROLES.map((rol) => (
                        <option key={rol} value={rol}>
                          {ROLE_LABEL[rol]}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isSelf}
                      onClick={() => handleUpdate(teamUser.id, { activo: !teamUser.activo })}
                    >
                      {teamUser.activo ? "Desactivar" : "Activar"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <NewUserForm onCreate={handleCreate} />

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
        {newPasswordFor && (
          <TemporaryPasswordBody email={newPasswordFor.email} password={newPasswordFor.password} />
        )}
      </Modal>
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
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <p className="text-[17px] font-bold text-admin-ink">Agregar a alguien del equipo</p>
        <div className="grid grid-cols-3 gap-3">
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
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" disabled={submitting || !nombre.trim() || !email.trim()} className="self-start">
          Crear usuario
        </Button>
      </form>
    </Card>
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
      <div className="flex items-center justify-between gap-2 rounded-[var(--radius-admin-control)] border border-admin-border px-3 py-2.5 font-mono text-sm text-admin-ink">
        {password}
        <Button variant="secondary" size="sm" onClick={handleCopy}>
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
    </div>
  );
}
