"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError, login } from "@/lib/api";
import { saveSession } from "@/lib/session";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session = await login({ email, password });
      saveSession(session);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo iniciar sesión");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-admin-sidebar p-4 font-admin">
      <div className="flex w-full max-w-[320px] flex-col gap-6 rounded-[14px] bg-white p-8 shadow-[0_20px_50px_rgba(0,0,0,0.3)]">
        <div>
          <h1 className="text-xl font-extrabold text-admin-ink">Inicia sesión</h1>
          <p className="mt-1 text-sm text-admin-ink/55">Entra al panel de tu negocio en Aelika.</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
            Correo
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="luis@negocio.com"
              className="input"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-bold text-admin-ink">
            Contraseña
            <input
              required
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="input"
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full rounded-lg bg-admin-green px-5 py-2.5 text-sm font-bold text-white transition hover:bg-admin-green-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Entrando..." : "Iniciar sesión"}
          </button>
        </form>

        <p className="text-center text-sm text-admin-ink/55">
          ¿Aún no tienes negocio en Aelika?{" "}
          <Link href="/register" className="font-bold text-admin-green underline">
            Regístralo aquí
          </Link>
        </p>
      </div>
    </main>
  );
}
