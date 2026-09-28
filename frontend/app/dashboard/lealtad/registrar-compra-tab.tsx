"use client";

import { useState } from "react";
import {
  ApiError,
  redimirPremioLealtad,
  registrarCompraLealtad,
  type LoyaltyCard,
  type WalletPassResultado,
} from "@/lib/api";
import { useSession } from "@/lib/session-context";
import Card from "../_components/Card";
import Button from "../_components/Button";
import QrScanner from "./qr-scanner";

// Códigos estructurados que el backend manda en ApiError.code (ver
// backend/src/lealtad/lealtad-errors.ts). Son la única forma en que esta
// pantalla distingue un resultado de negocio de un error — nunca por
// status ni por el texto del mensaje. Cualquier error sin uno de estos
// códigos (400 de validación, el 409 sin código de redimir-premio, 500,
// red caída...) se muestra como error genérico con el mensaje del backend.
const CODIGO_PREMIO_PENDIENTE = "PREMIO_PENDIENTE";
const CODIGO_SELLO_YA_REGISTRADO_HOY = "SELLO_YA_REGISTRADO_HOY";
const CODIGO_TOKEN_NO_ENCONTRADO = "TOKEN_NO_ENCONTRADO";

type Paso =
  // Cámara apagada, botón "Escanear tarjeta" visible. `errorCamara` viene
  // de un intento anterior que no pudo encender la cámara — el mismo botón
  // sirve para reintentar.
  | { tipo: "inicio"; errorCamara?: string }
  | { tipo: "escaneando" }
  | { tipo: "procesando" }
  | { tipo: "sello_registrado"; loyaltyCard: LoyaltyCard; pase: WalletPassResultado | null }
  | { tipo: "premio_pendiente"; qrToken: string }
  | { tipo: "premio_entregado"; loyaltyCard: LoyaltyCard }
  | { tipo: "ya_sello_hoy" }
  | { tipo: "no_encontrado" }
  | { tipo: "error_generico"; mensaje: string };

// La cámara solo existe mientras paso === "escaneando": <QrScanner> se monta
// al tocar "Escanear tarjeta" y se desmonta (liberando el stream) al leer un
// QR, al tocar "Cancelar", al cambiar de pestaña o al salir de la ruta.
// Ningún resultado vuelve a encenderla solo — todos regresan a "inicio".
export default function RegistrarCompraTab({ token }: { token: string }) {
  const { logout } = useSession();
  const [paso, setPaso] = useState<Paso>({ tipo: "inicio" });
  const [redimiendo, setRedimiendo] = useState(false);

  function volverAlInicio() {
    setPaso({ tipo: "inicio" });
  }

  async function handleScan(qrToken: string) {
    setPaso({ tipo: "procesando" });
    try {
      const respuesta = await registrarCompraLealtad(token, qrToken);
      setPaso({ tipo: "sello_registrado", loyaltyCard: respuesta.loyaltyCard, pase: respuesta.pase });
    } catch (err) {
      manejarError(err, qrToken);
    }
  }

  function manejarError(err: unknown, qrToken: string) {
    if (!(err instanceof ApiError)) {
      setPaso({ tipo: "error_generico", mensaje: "Ocurrió un error inesperado" });
      return;
    }

    // Sesión inválida/expirada — mismo trato que el resto del panel
    // (SessionProvider): se limpia la sesión y se manda a /login.
    if (err.status === 401) {
      logout();
      return;
    }

    switch (err.code) {
      case CODIGO_PREMIO_PENDIENTE:
        setPaso({ tipo: "premio_pendiente", qrToken });
        return;
      case CODIGO_SELLO_YA_REGISTRADO_HOY:
        setPaso({ tipo: "ya_sello_hoy" });
        return;
      case CODIGO_TOKEN_NO_ENCONTRADO:
        setPaso({ tipo: "no_encontrado" });
        return;
      default:
        setPaso({ tipo: "error_generico", mensaje: err.message });
    }
  }

  async function handleRedimir(qrToken: string) {
    setRedimiendo(true);
    try {
      const respuesta = await redimirPremioLealtad(token, qrToken);
      setPaso({ tipo: "premio_entregado", loyaltyCard: respuesta.loyaltyCard });
    } catch (err) {
      manejarError(err, qrToken);
    } finally {
      setRedimiendo(false);
    }
  }

  if (paso.tipo === "inicio") {
    return (
      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-extrabold text-admin-ink">Registrar nueva compra</h2>
          <p className="text-sm text-admin-ink-soft">
            Escanea el QR personal del cliente — vive dentro de la tarjeta ya agregada a su wallet.
          </p>
        </div>
        {paso.errorCamara && (
          <div className="rounded-[var(--radius-admin-control)] border border-admin-red-soft bg-admin-red-soft p-4">
            <p className="text-sm text-admin-red-dark">{paso.errorCamara}</p>
          </div>
        )}
        <Button onClick={() => setPaso({ tipo: "escaneando" })} className="self-start">
          {paso.errorCamara ? "Reintentar" : "Escanear tarjeta"}
        </Button>
      </Card>
    );
  }

  if (paso.tipo === "escaneando") {
    return (
      <Card className="flex flex-col items-center gap-4">
        <div className="self-stretch">
          <h2 className="text-sm font-extrabold text-admin-ink">Escanea el QR personal del cliente</h2>
          <p className="text-sm text-admin-ink-soft">Apunta la cámara al QR de la tarjeta en su wallet.</p>
        </div>
        <QrScanner onScan={handleScan} onError={(mensaje) => setPaso({ tipo: "inicio", errorCamara: mensaje })} />
        <Button variant="secondary" onClick={volverAlInicio}>
          Cancelar
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
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => handleRedimir(loyaltyCard.token)} disabled={redimiendo}>
              {redimiendo ? "Confirmando..." : "Marcar premio entregado"}
            </Button>
            <Button variant="secondary" onClick={volverAlInicio} disabled={redimiendo}>
              Volver sin canjear
            </Button>
          </div>
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
        <Button onClick={volverAlInicio} className="self-start">
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
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => handleRedimir(paso.qrToken)} disabled={redimiendo}>
            {redimiendo ? "Confirmando..." : "Marcar premio entregado"}
          </Button>
          <Button variant="secondary" onClick={volverAlInicio} disabled={redimiendo}>
            Volver sin canjear
          </Button>
        </div>
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
        <Button onClick={volverAlInicio} className="self-start">
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
        <Button onClick={volverAlInicio} className="self-start">
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
        <Button onClick={volverAlInicio} className="self-start">
          Escanear otro
        </Button>
      </Card>
    );
  }

  // error_generico
  return (
    <Card className="flex flex-col gap-4">
      <div className="rounded-[var(--radius-admin-control)] border border-admin-red-soft bg-admin-red-soft p-4">
        <p className="text-sm text-admin-red-dark">{paso.mensaje}</p>
      </div>
      <Button onClick={volverAlInicio} className="self-start">
        Volver al inicio
      </Button>
    </Card>
  );
}
