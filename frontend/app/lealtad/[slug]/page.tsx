"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, altaClienteLealtadPublico, fetchPublicTenant, type LealtadRespuesta, type PublicTenantInfo } from "@/lib/api";

// Página angosta de un solo formulario — mismo molde de resolución de
// tenant por slug que /tienda y /mayoreo (useParams + fetch en useEffect +
// estado notFound/error), pero sin catálogo ni carrito: aquí solo hay un
// alta de cliente. Reutiliza fetchPublicTenant (GET /public/tenants/:slug,
// el mismo que ya consume /tienda) solo para nombre/logo/notFound — el alta
// en sí pega al endpoint nuevo de PublicLealtadController.
const WRAPPER = "mx-auto flex min-h-screen w-full max-w-md flex-col items-center bg-white p-6 text-black";

export default function LealtadPublicoPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [tenant, setTenant] = useState<PublicTenantInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [resultado, setResultado] = useState<LealtadRespuesta | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const tenantData = await fetchPublicTenant(slug);
        setTenant(tenantData);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(err instanceof ApiError ? err.message : "No se pudo cargar la información del negocio");
        }
      }
    }
    load();
  }, [slug]);

  // Redirección automática al link del pase en cuanto llega — el cliente
  // no tiene nada más que hacer en esta página una vez que su tarjeta ya
  // existe.
  useEffect(() => {
    if (resultado?.pase?.shareUrl) {
      window.location.href = resultado.pase.shareUrl;
    }
  }, [resultado]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const respuesta = await altaClienteLealtadPublico(slug, nombre.trim(), telefono.trim());
      setResultado(respuesta);
    } catch (err) {
      setErrorEnvio(err instanceof ApiError ? err.message : "No se pudo completar el registro");
    } finally {
      setEnviando(false);
    }
  }

  if (notFound) {
    return (
      <div className={`${WRAPPER} items-center justify-center text-center`}>
        <p className="text-black/60">No encontramos este negocio.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`${WRAPPER} items-center justify-center text-center`}>
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className={`${WRAPPER} items-center justify-center text-center`}>
        <p className="text-black/60">Cargando...</p>
      </div>
    );
  }

  // pase === null: el Cliente y su LoyaltyCard sí quedaron registrados del
  // lado de Aelika, solo falló la generación del pase visual — nunca se
  // redirige en este caso (ver el useEffect de arriba).
  if (resultado && !resultado.pase) {
    return (
      <div className={`${WRAPPER} justify-center gap-3 text-center`}>
        <h1 className="text-lg font-semibold">{tenant.nombre}</h1>
        <p className="text-black/70">
          Tu registro se completó, pero no pudimos generar tu tarjeta en este momento. Intenta registrarte de nuevo
          con el mismo teléfono en unos minutos para conseguir el link.
        </p>
      </div>
    );
  }

  if (resultado?.pase) {
    return (
      <div className={`${WRAPPER} justify-center gap-3 text-center`}>
        <p className="text-black/60">Te estamos llevando a tu tarjeta...</p>
      </div>
    );
  }

  return (
    <div className={`${WRAPPER} justify-center gap-6`}>
      <div className="flex flex-col items-center gap-2 text-center">
        {tenant.logoUrl && <img src={tenant.logoUrl} alt={tenant.nombre} className="h-16 w-16 rounded-full object-cover" />}
        <h1 className="text-lg font-semibold">{tenant.nombre}</h1>
        <p className="text-black/60">Regístrate para empezar a juntar sellos en tu tarjeta de lealtad.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Nombre
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            minLength={2}
            maxLength={120}
            className="input"
            placeholder="Tu nombre"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Teléfono
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            required
            minLength={7}
            maxLength={20}
            className="input"
            placeholder="10 dígitos"
            inputMode="tel"
          />
        </label>

        {errorEnvio && <p className="text-sm text-red-600">{errorEnvio}</p>}

        <button
          type="submit"
          disabled={enviando}
          className="mt-2 rounded-full bg-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {enviando ? "Registrando..." : "Registrarme"}
        </button>
      </form>
    </div>
  );
}
