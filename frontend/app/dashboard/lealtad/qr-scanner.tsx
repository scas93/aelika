"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";

interface QrScannerProps {
  // Se llama una sola vez por montaje, con el texto decodificado del QR —
  // el guard interno (`scanned`) evita que el loop de decodificación
  // continua de zxing dispare esto varias veces para el mismo código antes
  // de que el padre desmonte este componente (ver registrar-compra-tab.tsx,
  // que desmonta el scanner en cuanto hay un resultado).
  onScan: (texto: string) => void;
}

// Primera integración de lectura de QR con cámara en el proyecto —
// confirmado por auditoría que no existía ninguna librería para esto.
// @zxing/browser maneja el acceso a la cámara y el loop de decodificación
// por su cuenta; solo hay que darle un <video> y un callback.
export default function QrScanner({ onScan }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let scanned = false;
    let cancelado = false;
    let controls: { stop: () => void } | null = null;
    const reader = new BrowserQRCodeReader();

    reader
      .decodeFromConstraints(
        // "environment" pide la cámara trasera en celular/tablet — la
        // pantalla de la cajera escanea la tarjeta del cliente, no una
        // selfie.
        { video: { facingMode: "environment" } },
        videoRef.current ?? undefined,
        (result) => {
          if (result && !scanned) {
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
      .catch(() => {
        setError("No se pudo acceder a la cámara — revisa los permisos del navegador para este sitio.");
      });

    return () => {
      cancelado = true;
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onScan se lee por closure al momento del scan, no necesita re-suscribirse
  }, []);

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  return (
    <video
      ref={videoRef}
      className="aspect-square w-full max-w-sm rounded-[var(--radius-admin-card)] border border-admin-border bg-black object-cover"
      muted
      playsInline
    />
  );
}
