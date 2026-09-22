"use client";

import { useState } from "react";
import {
  ApiError,
  redimirPremioLealtad,
  registrarCompraLealtad,
  type LoyaltyCard,
  type WalletPassResultado,
} from "@/lib/api";
import Card from "../_components/Card";
import Button from "../_components/Button";
import QrScanner from "./qr-scanner";

// Códigos estructurados que el backend manda en ApiError.code (ver
// backend/src/lealtad/lealtad-errors.ts) — reemplaza el match anterior por
// contenido del mensaje, que se rompía en silencio si alguien cambiaba la
// redacción sin saber que este archivo dependía de ese texto exacto. El
// 404 (TOKEN_NO_ENCONTRADO) no necesita este tratamiento — es el único
// significado posible de ese status en estos 2 endpoints, se sigue
// distinguiendo solo por `err.status`.
const CODIGO_PREMIO_PENDIENTE = "PREMIO_PENDIENTE";

type Paso =
  | { tipo: "pin" }
  | { tipo: "escaneando" }
  | { tipo: "procesando" }
  | { tipo: "sello_registrado"; loyaltyCard: LoyaltyCard; pase: WalletPassResultado | null }
  | { tipo: "premio_pendiente"; qrToken: string }
  | { tipo: "premio_entregado"; loyaltyCard: LoyaltyCard }
  | { tipo: "ya_sello_hoy" }
  | { tipo: "no_encontrado" }
  | { tipo: "sin_pin_configurado" }
  | { tipo: "error_generico"; mensaje: string };

export default function RegistrarCompraTab({ token }: { token: string }) {
  const [pin, setPin] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [bloqueado, setBloqueado] = useState(false);
  const [paso, setPaso] = useState<Paso>({ tipo: "pin" });
  const [redimiendo, setRedimiendo] = useState(false);

  function handleDesbloquear(e: React.FormEvent) {
    e.preventDefault();
    // No hay endpoint para "solo verificar el PIN" — se valida hasta el
    // primer escaneo real (ver handleScan). Este paso solo recolecta el
    // valor antes de prender la cámara.
    setPin(pinInput);
    setPinError(null);
    setBloqueado(false);
    setPaso({ tipo: "escaneando" });
  }

  async function handleScan(qrToken: string) {
    setPaso({ tipo: "procesando" });
    try {
      const respuesta = await registrarCompraLealtad(token, qrToken, pin);
      setPaso({ tipo: "sello_registrado", loyaltyCard: respuesta.loyaltyCard, pase: respuesta.pase });
    } catch (err) {
      manejarError(err, qrToken);
    }
  }

  function manejarError(err: unknown, qrToken?: string) {
    if (!(err instanceof ApiError)) {
      setPaso({ tipo: "error_generico", mensaje: "Ocurrió un error inesperado" });
      return;
    }

    // PIN incorrecto o bloqueado: no tiene caso seguir escaneando con un
    // PIN que ya sabemos que falla — regresa a pedirlo de nuevo.
    if (err.status === 401) {
      setPin("");
      setPinInput("");
      setPinError("PIN incorrecto — intenta de nuevo.");
      setBloqueado(false);
      setPaso({ tipo: "pin" });
      return;
    }
    if (err.status === 403) {
      setPin("");
      setPinInput("");
      setPinError("PIN bloqueado temporalmente por demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.");
      setBloqueado(true);
      setPaso({ tipo: "pin" });
      return;
    }
    if (err.status === 400) {
      setPaso({ tipo: "sin_pin_configurado" });
      return;
    }
    if (err.status === 404) {
      setPaso({ tipo: "no_encontrado" });
      return;
    }
    if (err.status === 409) {
      if (err.code === CODIGO_PREMIO_PENDIENTE && qrToken) {
        setPaso({ tipo: "premio_pendiente", qrToken });
      } else {
        setPaso({ tipo: "ya_sello_hoy" });
      }
      return;
    }
    setPaso({ tipo: "error_generico", mensaje: err.message });
  }

  async function handleRedimir(qrToken: string) {
    setRedimiendo(true);
    try {
      const respuesta = await redimirPremioLealtad(token, qrToken, pin);
      setPaso({ tipo: "premio_entregado", loyaltyCard: respuesta.loyaltyCard });
    } catch (err) {
      manejarError(err, qrToken);
    } finally {
      setRedimiendo(false);
    }
  }

  function volverAEscanear() {
    setPaso({ tipo: "escaneando" });
  }

  if (paso.tipo === "pin") {
    return (
      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-admin-ink">Registrar nueva compra</h2>
          <p className="text-sm text-admin-ink-soft">Ingresa el PIN del negocio para desbloquear el escáner.</p>
        </div>
        <form onSubmit={handleDesbloquear} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-admin-ink">
            PIN
            <input
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              required
              inputMode="numeric"
              pattern="\d{4,6}"
              minLength={4}
              maxLength={6}
              autoFocus
              className="admin-input"
              placeholder="4-6 dígitos"
            />
          </label>
          {pinError && <p className={`text-sm ${bloqueado ? "text-amber-700" : "text-red-600"}`}>{pinError}</p>}
          <Button type="submit" className="self-start">
            Desbloquear escáner
          </Button>
        </form>
      </Card>
    );
  }

  if (paso.tipo === "sin_pin_configurado") {
    return (
      <Card className="flex flex-col gap-2">
        <p className="text-sm text-admin-ink">Este negocio todavía no tiene un PIN de Lealtad configurado.</p>
        <p className="text-sm text-admin-ink-soft">
          El Dueño puede definirlo en Ajustes → Conexión Lealtad antes de poder registrar compras.
        </p>
      </Card>
    );
  }

  if (paso.tipo === "escaneando") {
    return (
      <Card className="flex flex-col items-center gap-4">
        <div className="self-stretch">
          <h2 className="text-sm font-extrabold text-admin-ink">Escanea el QR personal del cliente</h2>
          <p className="text-sm text-admin-ink-soft">El QR vive dentro de la tarjeta ya agregada a su wallet.</p>
        </div>
        <QrScanner onScan={handleScan} />
        <Button variant="secondary" size="sm" onClick={() => setPaso({ tipo: "pin" })}>
          Cambiar PIN / detener
        </Button>
      </Card>
    );
  }

  if (paso.tipo === "procesando") {
    return (
      <Card>
        <p className="text-sm text-admin-ink-soft">Registrando sello...</p>
      </Card>
    );
  }

  if (paso.tipo === "sello_registrado") {
    const { loyaltyCard, pase } = paso;
    if (loyaltyCard.estado === "PREMIO_DISPONIBLE") {
      return (
        <Card className="flex flex-col gap-4">
          <div className="rounded-[var(--radius-admin-control)] border border-amber-300 bg-amber-50 p-4">
            <p className="text-base font-extrabold text-amber-900">🎉 ¡Premio disponible! 10/10</p>
            <p className="text-sm text-amber-800">
              Este cliente completó su tarjeta. Entrégale la recompensa que decidas y confirma abajo.
            </p>
          </div>
          <Button onClick={() => handleRedimir(loyaltyCard.token)} disabled={redimiendo} className="self-start">
            {redimiendo ? "Confirmando..." : "Marcar premio entregado"}
          </Button>
        </Card>
      );
    }

    return (
      <Card className="flex flex-col gap-4">
        <div className="rounded-[var(--radius-admin-control)] border border-admin-green bg-admin-green-soft p-4">
          <p className="text-base font-extrabold text-admin-green-dark">Sello registrado</p>
          <p className="text-sm text-admin-green-dark">Sellos: {loyaltyCard.contador}/10</p>
        </div>
        {!pase && (
          <p className="text-xs text-amber-700">
            El sello quedó guardado, pero la tarjeta del wallet no se pudo refrescar en este momento — se actualizará
            sola en el próximo sello.
          </p>
        )}
        <Button onClick={volverAEscanear} className="self-start">
          Escanear otro
        </Button>
      </Card>
    );
  }

  if (paso.tipo === "premio_pendiente") {
    return (
      <Card className="flex flex-col gap-4">
        <div className="rounded-[var(--radius-admin-control)] border border-amber-300 bg-amber-50 p-4">
          <p className="text-base font-extrabold text-amber-900">Esta tarjeta ya tiene un premio pendiente</p>
          <p className="text-sm text-amber-800">Hay que redimirlo antes de poder registrar otro sello.</p>
        </div>
        <Button onClick={() => handleRedimir(paso.qrToken)} disabled={redimiendo} className="self-start">
          {redimiendo ? "Confirmando..." : "Marcar premio entregado"}
        </Button>
      </Card>
    );
  }

  if (paso.tipo === "premio_entregado") {
    return (
      <Card className="flex flex-col gap-4">
        <div className="rounded-[var(--radius-admin-control)] border border-admin-green bg-admin-green-soft p-4">
          <p className="text-base font-extrabold text-admin-green-dark">Premio entregado</p>
          <p className="text-sm text-admin-green-dark">
            El ciclo de esta tarjeta reinició — sellos: {paso.loyaltyCard.contador}/10.
          </p>
        </div>
        <Button onClick={volverAEscanear} className="self-start">
          Escanear otro
        </Button>
      </Card>
    );
  }

  if (paso.tipo === "ya_sello_hoy") {
    return (
      <Card className="flex flex-col gap-4">
        <div className="rounded-[var(--radius-admin-control)] border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            Esta tarjeta ya registró un sello el día de hoy — máximo 1 sello por día.
          </p>
        </div>
        <Button onClick={volverAEscanear} className="self-start">
          Escanear otro
        </Button>
      </Card>
    );
  }

  if (paso.tipo === "no_encontrado") {
    return (
      <Card className="flex flex-col gap-4">
        <div className="rounded-[var(--radius-admin-control)] border border-admin-red-soft bg-admin-red-soft p-4">
          <p className="text-sm text-admin-red-dark">No se encontró ninguna tarjeta con ese código.</p>
        </div>
        <Button onClick={volverAEscanear} className="self-start">
          Escanear otro
        </Button>
      </Card>
    );
  }

  // error_generico
  return (
    <Card className="flex flex-col gap-4">
      <p className="text-sm text-red-600">{paso.mensaje}</p>
      <Button onClick={volverAEscanear} className="self-start">
        Escanear otro
      </Button>
    </Card>
  );
}
