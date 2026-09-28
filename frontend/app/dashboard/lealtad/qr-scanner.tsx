"use client";

import { useEffect, useRef } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";

interface QrScannerProps {
  // Se llama una sola vez por montaje, con el texto decodificado del QR —
  // el guard interno (`scanned`) evita que el loop de decodificación
  // continua de zxing dispare esto varias veces para el mismo código antes
  // de que el padre desmonte este componente (ver registrar-compra-tab.tsx,
  // que desmonta el scanner en cuanto hay un resultado).
  onScan: (texto: string) => void;
  // Se llama si no se pudo encender la cámara (permiso negado, sin cámara,
  // cámara ocupada, contexto no seguro...) con un mensaje listo para
  // mostrar. El padre decide qué hacer — hoy regresa al estado inicial con
  // el botón "Escanear tarjeta" para reintentar.
  onError: (mensaje: string) => void;
}

// Traduce el error de getUserMedia (DOMException con `name` estándar) a un
// mensaje accionable para la cajera.
function mensajeErrorCamara(err: unknown): string {
  if (typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia) {
    return "Este navegador no permite usar la cámara en esta página. Abre el panel desde https (o localhost) en Chrome, Edge o Safari.";
  }
  const nombre = err instanceof DOMException || err instanceof Error ? err.name : "";
  switch (nombre) {
    case "NotAllowedError":
    case "SecurityError":
      return "Se negó el permiso para usar la cámara. Actívalo en la configuración del navegador para este sitio y vuelve a intentar.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No se encontró ninguna cámara en este dispositivo.";
    case "NotReadableError":
    case "AbortError":
      return "La cámara está en uso por otra aplicación o pestaña. Ciérrala y vuelve a intentar.";
    default:
      return "No se pudo acceder a la cámara. Revisa los permisos del navegador para este sitio y vuelve a intentar.";
  }
}

// Primera integración de lectura de QR con cámara en el proyecto.
// @zxing/browser maneja el acceso a la cámara y el loop de decodificación
// por su cuenta; solo hay que darle un <video> y un callback. La cámara
// vive exactamente lo que vive este componente: se enciende al montar y
// `controls.stop()` (cleanup) detiene los tracks del stream al desmontar —
// al leer un QR, al cancelar, al cambiar de pestaña o al salir de la ruta.
export default function QrScanner({ onScan, onError }: QrScannerProps) {
  const contenedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let scanned = false;
    let cancelado = false;
    let controls: { stop: () => void } | null = null;
    const reader = new BrowserQRCodeReader();

    // Un <video> propio por cada ejecución del efecto, en vez de uno
    // compartido vía ref: si un montaje se descarta antes de que la cámara
    // termine de arrancar (React StrictMode en dev monta dos veces), su
    // `c.stop()` tardío limpia el srcObject del <video> que recibió — con
    // un <video> compartido eso dejaba en negro el del montaje vigente y el
    // escáner nunca leía nada.
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.className = VIDEO_CLASSES;
    contenedorRef.current?.appendChild(video);

    reader
      .decodeFromConstraints(
        // "environment" pide la cámara trasera en celular/tablet — la
        // pantalla de la cajera escanea la tarjeta del cliente, no una
        // selfie.
        { video: { facingMode: "environment" } },
        video,
        (result) => {
          if (result && !scanned && !cancelado) {
            scanned = true;
            onScan(result.getText());
          }
        },
      )
      .then((c) => {
        if (cancelado) {
          c.stop();
          return;
        }
        controls = c;
      })
      .catch((err) => {
        if (!cancelado) onError(mensajeErrorCamara(err));
      });

    return () => {
      cancelado = true;
      controls?.stop();
      video.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onScan/onError se leen por closure al momento del evento, no necesitan re-suscribirse
  }, []);

  return <div ref={contenedorRef} className="flex w-full justify-center" />;
}

const VIDEO_CLASSES =
  "aspect-square w-full max-w-sm rounded-[var(--radius-admin-card)] border border-admin-border bg-black object-cover";
