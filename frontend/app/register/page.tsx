"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ApiError,
  checkSlugAvailability,
  horarioSemanaVacio,
  register,
  TIPOS_STOREFRONT,
  type HorarioSemana,
  type TipoStorefront,
} from "@/lib/api";
import { saveSession } from "@/lib/session";
import { slugify } from "@/lib/slug";
import HorarioEditor from "@/components/horario-editor";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default function RegisterPage() {
  const router = useRouter();

  const [nombreNegocio, setNombreNegocio] = useState("");
  const [manualSlug, setManualSlug] = useState<string | null>(null);
  const [slugCheck, setSlugCheck] = useState<{ slug: string; available: boolean } | null>(null);

  const [nombreDueno, setNombreDueno] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Sin default a propósito — quien registra debe elegirlo explícitamente
  // (ver CLAUDE.md), así que arranca sin selección en vez de preseleccionar
  // "Retail (B2C)" en silencio.
  const [tipoStorefront, setTipoStorefront] = useState<TipoStorefront | null>(null);
  const [horario, setHorario] = useState<HorarioSemana>(() => horarioSemanaVacio());
  const [ubicacion, setUbicacion] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Derived: the slug tracks nombreNegocio automatically until the user edits it directly.
  const slug = manualSlug ?? slugify(nombreNegocio);
  const isValidSlugFormat = slug.length >= 3 && SLUG_PATTERN.test(slug);
  const slugStatus = !isValidSlugFormat
    ? slug.length === 0
      ? "idle"
      : "invalid"
    : slugCheck?.slug === slug
      ? slugCheck.available
        ? "available"
        : "taken"
      : "checking";

  useEffect(() => {
    if (!isValidSlugFormat) return;

    let cancelled = false;
    const timeout = setTimeout(async () => {
      try {
        const result = await checkSlugAvailability(slug);
        if (!cancelled) {
          setSlugCheck({ slug, available: result.available });
        }
      } catch {
        // Network hiccup: leave status as "checking" so the user can retry by editing the field.
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [slug, isValidSlugFormat]);

  const canSubmit =
    slugStatus === "available" &&
    nombreNegocio.trim().length > 1 &&
    nombreDueno.trim().length > 1 &&
    email.trim().length > 3 &&
    password.length >= 8 &&
    tipoStorefront !== null &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !tipoStorefront) return;

    setSubmitting(true);
    setError(null);
    try {
      const session = await register({
        nombreNegocio,
        slug,
        nombreDueno,
        email,
        password,
        tipoStorefront,
        horarioAtencion: horario,
        ubicacion: ubicacion || undefined,
      });
      saveSession(session);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo completar el registro");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Crea tu negocio en Aelika</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Empieza a recibir pedidos sin pagar comisión.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Field label="Nombre del negocio">
          <input
            required
            value={nombreNegocio}
            onChange={(e) => setNombreNegocio(e.target.value)}
            placeholder="Pizzería Don Luis"
            className="input"
          />
        </Field>

        <Field
          label="Tu página de pedidos"
          hint={
            slugStatus === "checking"
              ? "Verificando disponibilidad..."
              : slugStatus === "available"
                ? "Disponible"
                : slugStatus === "taken"
                  ? "Este slug ya está en uso"
                  : slugStatus === "invalid"
                    ? "Usa al menos 3 letras/números y guiones"
                    : undefined
          }
          hintTone={
            slugStatus === "available" ? "ok" : slugStatus === "taken" || slugStatus === "invalid" ? "error" : "neutral"
          }
        >
          <div className="flex items-center gap-1 rounded-lg border border-black/15 pl-3 text-sm text-black/50 focus-within:border-black/40 dark:border-white/20 dark:text-white/50">
            <span>pide.aelika.com/</span>
            <input
              required
              value={slug}
              onChange={(e) => setManualSlug(slugify(e.target.value))}
              placeholder="pizzeria-don-luis"
              className="w-full rounded-lg bg-transparent py-2.5 pr-3 text-black outline-none dark:text-white"
            />
          </div>
        </Field>

        <Field label="Tu nombre (dueño/a)">
          <input
            required
            value={nombreDueno}
            onChange={(e) => setNombreDueno(e.target.value)}
            placeholder="Luis Pérez"
            className="input"
          />
        </Field>

        <Field label="Correo">
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="luis@negocio.com"
            className="input"
          />
        </Field>

        <Field label="Contraseña" hint="Mínimo 8 caracteres">
          <input
            required
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="input"
          />
        </Field>

        <fieldset className="flex flex-col gap-1.5 text-sm font-medium">
          <legend className="mb-0.5">Tipo de negocio</legend>
          <div className="flex flex-col gap-2">
            {TIPOS_STOREFRONT.map((opcion) => (
              <label
                key={opcion.value}
                className={`flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 text-sm transition ${
                  tipoStorefront === opcion.value
                    ? "border-black bg-black/5 dark:border-white dark:bg-white/10"
                    : "border-black/15 hover:border-black/30 dark:border-white/20 dark:hover:border-white/40"
                }`}
              >
                <span className="flex items-center gap-2 font-semibold">
                  <input
                    required
                    type="radio"
                    name="tipoStorefront"
                    checked={tipoStorefront === opcion.value}
                    onChange={() => setTipoStorefront(opcion.value)}
                  />
                  {opcion.label}
                </span>
                <span className="pl-5 text-xs font-normal text-black/60 dark:text-white/60">
                  {opcion.descripcion}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <HorarioEditor horario={horario} onChange={setHorario} />

        <Field label="Ubicación (opcional)">
          <input
            value={ubicacion}
            onChange={(e) => setUbicacion(e.target.value)}
            placeholder="Av. Siempre Viva 123"
            className="input"
          />
        </Field>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-2 rounded-full bg-black px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {submitting ? "Creando..." : "Crear mi negocio"}
        </button>
      </form>

      <p className="text-center text-sm text-black/60 dark:text-white/60">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-medium underline">
          Inicia sesión
        </Link>
      </p>
    </main>
  );
}

function Field({
  label,
  hint,
  hintTone = "neutral",
  children,
}: {
  label: string;
  hint?: string;
  hintTone?: "neutral" | "ok" | "error";
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      {children}
      {hint && (
        <span
          className={
            hintTone === "ok"
              ? "text-xs font-normal text-green-600"
              : hintTone === "error"
                ? "text-xs font-normal text-red-600"
                : "text-xs font-normal text-black/50 dark:text-white/50"
          }
        >
          {hint}
        </span>
      )}
    </label>
  );
}
