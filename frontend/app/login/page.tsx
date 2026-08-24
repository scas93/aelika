"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError, login } from "@/lib/api";
import { saveSession } from "@/lib/session";
import Button from "@/app/dashboard/_components/Button";

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
    <main className="flex min-h-screen w-full bg-white font-admin">
      {/* No hero image asset exists in the project yet — solid admin-green
          block as the placeholder, per the design spec's fallback. Hidden
          below md: the panel itself is desktop-only, but login is the
          entry point and a fixed 45/55 split isn't viable on a phone. */}
      <div className="hidden shrink-0 basis-[45%] p-4 md:block">
        <div className="h-full w-full rounded-[var(--radius-admin-card)] bg-admin-green" />
      </div>

      <div className="flex flex-1 flex-col">
        <div className="flex justify-end p-6">
          <span className="text-lg font-extrabold text-admin-ink">Aelika</span>
        </div>

        <div className="flex flex-1 items-center justify-center p-4">
          <div className="flex w-full max-w-[440px] flex-col gap-8">
            <div>
              <h1 className="text-[32px] font-bold text-admin-ink">Inicia sesión</h1>
              <p className="mt-1 text-[15px] text-admin-ink-soft">Entra al panel de tu negocio en Aelika.</p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
                Correo
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="luis@negocio.com"
                  className="admin-input"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
                Contraseña
                <input
                  required
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="admin-input"
                />
              </label>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <Button type="submit" variant="primary" size="lg" fullWidth disabled={submitting} className="mt-2">
                {submitting ? "Entrando..." : "Iniciar sesión"}
              </Button>
            </form>

            <p className="text-center text-sm text-admin-ink-soft">
              ¿Aún no tienes negocio en Aelika?{" "}
              <Link href="/register" className="font-semibold text-admin-green underline">
                Regístralo aquí
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
