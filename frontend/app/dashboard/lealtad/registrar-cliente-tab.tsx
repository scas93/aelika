"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ApiError, altaClienteLealtad, type LealtadRespuesta } from "@/lib/api";
import Card from "../_components/Card";
import Button from "../_components/Button";

// Sección fija (link + QR de /lealtad/[slug]) — siempre visible, independiente
// de si el formulario de abajo está en su estado inicial o mostrando el
// resultado de un alta manual reciente; por eso vive en su propio Card, fuera
// del if/else de abajo. Se construye con window.location.origin (mismo
// dominio donde ya vive el dashboard) porque no hay ninguna variable de
// entorno de dominio público configurada en el frontend — ver auditoría.
// Seguro leer window aquí: este componente solo se monta después de que
// SessionProvider resuelve la sesión en un useEffect, nunca en el render de
// servidor.
function LinkAutoRegistroSection({ slug }: { slug: string }) {
  const [copiado, setCopiado] = useState(false);
  const link = `${window.location.origin}/lealtad/${slug}`;

  function handleCopiar() {
    navigator.clipboard.writeText(link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-extrabold text-admin-ink">Link de auto-registro</h2>
        <p className="text-sm text-admin-ink-soft">
          Compártelo o pégalo en mostrador (impreso o en pantalla) para que los clientes se registren solos, sin que
          tengas que capturarlos tú.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-[var(--radius-admin-control)] border border-admin-border bg-admin-bg px-3 py-2 text-xs text-admin-ink">
          {link}
        </code>
        <Button variant="secondary" size="sm" onClick={handleCopiar} className="shrink-0">
          {copiado ? "¡Copiado!" : "Copiar"}
        </Button>
      </div>

      <div className="flex justify-center rounded-[var(--radius-admin-control)] border border-admin-border bg-white p-4">
        {/* size en px, pero es SVG — escala sin perder nitidez al imprimir,
            no es un raster de baja resolución. */}
        <QRCodeSVG value={link} size={240} level="M" />
      </div>
    </Card>
  );
}

export default function RegistrarClienteTab({ token, slug }: { token: string; slug: string }) {
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<LealtadRespuesta | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const respuesta = await altaClienteLealtad(token, nombre.trim(), telefono.trim());
      setResultado(respuesta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar al cliente");
    } finally {
      setEnviando(false);
    }
  }

  function handleNuevoRegistro() {
    setResultado(null);
    setNombre("");
    setTelefono("");
  }

  return (
    <div className="flex flex-col gap-4">
      <LinkAutoRegistroSection slug={slug} />

      {resultado ? (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-extrabold text-admin-ink">Cliente registrado</h2>
            <p className="text-sm text-admin-ink-soft">
              {nombre || "El cliente"} ya tiene su tarjeta de lealtad — sello {resultado.loyaltyCard.contador}/10.
            </p>
          </div>

          {resultado.pase ? (
            <div className="flex flex-col gap-2 rounded-[var(--radius-admin-control)] border border-admin-border bg-admin-bg p-3">
              <p className="text-sm font-semibold text-admin-ink">Link para agregar la tarjeta al wallet</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded-[var(--radius-admin-control)] border border-admin-border bg-white px-3 py-2 text-xs text-admin-ink">
                  {resultado.pase.shareUrl}
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigator.clipboard.writeText(resultado.pase!.shareUrl)}
                  className="shrink-0"
                >
                  Copiar
                </Button>
              </div>
              <p className="text-xs text-admin-ink-soft">
                Compártelo con el cliente (WhatsApp, mensaje, o que lo abra directo desde su celular) para que agregue
                la tarjeta a su Apple/Google Wallet.
              </p>
            </div>
          ) : (
            <div className="rounded-[var(--radius-admin-control)] border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-amber-800">
                El cliente y su tarjeta ya quedaron registrados, pero no se pudo generar el link del wallet en este
                momento. Intenta registrarlo de nuevo con el mismo teléfono en unos minutos para conseguir el link.
              </p>
            </div>
          )}

          <Button variant="secondary" onClick={handleNuevoRegistro} className="self-start">
            Registrar otro cliente
          </Button>
        </Card>
      ) : (
        <Card className="flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-extrabold text-admin-ink">Registrar nuevo cliente</h2>
            <p className="text-sm text-admin-ink-soft">
              Si el teléfono ya tiene una tarjeta (por ejemplo, porque el cliente ya compró antes en línea), se
              reutiliza — nunca se duplica.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Nombre
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
                minLength={2}
                maxLength={120}
                className="admin-input"
                placeholder="Nombre del cliente"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
              Teléfono
              <input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                required
                minLength={7}
                maxLength={20}
                className="admin-input"
                placeholder="10 dígitos"
                inputMode="tel"
              />
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" disabled={enviando} className="self-start">
              {enviando ? "Registrando..." : "Registrar"}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
