"use client";

import { useState } from "react";
import { useSession } from "@/lib/session-context";
import { ApiError, changePassword } from "@/lib/api";

const CARD = "rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]";
const BTN_PRIMARY =
  "mt-2 rounded-lg bg-admin-green px-5 py-2.5 text-sm font-bold text-white transition hover:bg-admin-green-dark disabled:cursor-not-allowed disabled:opacity-40";

export default function CambiarPasswordPage() {
  const { token } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit = currentPassword.length > 0 && newPassword.length >= 8 && !mismatch && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await changePassword(token, { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar la contraseña");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`${CARD} mx-auto flex w-full max-w-md flex-col gap-6 p-6`}>
      <div>
        <h2 className="text-lg font-extrabold text-admin-ink">Cambiar contraseña</h2>
        <p className="mt-1 text-sm text-admin-ink/55">Si entraste con una contraseña temporal, cámbiala por una tuya.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
          Contraseña actual
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="input"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
          Contraseña nueva
          <input
            type="password"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="input"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
          Confirmar contraseña nueva
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="input"
          />
          {mismatch && <span className="text-xs font-normal text-red-600">Las contraseñas no coinciden</span>}
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-admin-green-dark">Contraseña actualizada.</p>}

        <button type="submit" disabled={!canSubmit} className={BTN_PRIMARY}>
          {submitting ? "Guardando..." : "Guardar"}
        </button>
      </form>
    </div>
  );
}
