"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import Card from "../../_components/Card";
import Badge from "../../_components/Badge";
import ToggleSwitch from "../../_components/ToggleSwitch";

/**
 * Tarjeta de UN aviso de mayoreo (Ajustes → Notificaciones): título, descripción, un solo estado (Encendido/Apagado), a quién se
 * envía, lo que falta para poder encenderlo y un solo interruptor. Por dentro un aviso son un canal y un evento, pero la persona
 * nunca los ve: el interruptor los maneja juntos.
 */
export default function AvisoCard({
  titulo,
  descripcion,
  encendido,
  destino,
  faltan,
  enlaceFalta,
  ocupado,
  onInterruptor,
  children,
}: {
  titulo: string;
  descripcion: string;
  encendido: boolean;
  /** A quién se envía, en una línea («3 destinatarios: Ana, Luis…» o «Sin destinatarios»). */
  destino: string;
  /** Lo que falta para poder encenderlo (solo se muestra apagado). Vacío = se puede encender. */
  faltan: string[];
  enlaceFalta?: { label: string; href: string };
  ocupado: boolean;
  onInterruptor: () => void;
  children?: ReactNode;
}) {
  const bloqueado = !encendido && faltan.length > 0;
  return (
    <Card className="flex min-w-0 flex-col gap-3" role="group" aria-label={titulo}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-extrabold text-admin-ink">{titulo}</h3>
            {encendido ? <Badge variant="exito">Encendido</Badge> : <Badge variant="neutro">Apagado</Badge>}
          </div>
          <p className="text-sm text-admin-ink-soft">{descripcion}</p>
        </div>
        <ToggleSwitch
          checked={encendido}
          disabled={ocupado || bloqueado}
          onChange={onInterruptor}
          label={`${encendido ? "Apagar" : "Encender"}: ${titulo}`}
        />
      </div>

      <p className="text-xs text-admin-ink-soft">
        <span className="font-semibold text-admin-ink">Se envía a: </span>
        {destino}
      </p>

      {!encendido && faltan.length > 0 && (
        <div className="flex flex-col gap-0.5 text-xs font-medium text-amber-800">
          {faltan.map((f) => (
            <span key={f}>{f}</span>
          ))}
          {enlaceFalta && (
            <Link href={enlaceFalta.href} className="font-semibold text-admin-accent-dark underline-offset-2 hover:underline">
              {enlaceFalta.label}
            </Link>
          )}
        </div>
      )}

      {children}
    </Card>
  );
}

/** Sección plegada («Probar»): cerrada por defecto para no recargar la tarjeta. */
export function Plegable({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <details className="border-t border-admin-border pt-3">
      <summary className="cursor-pointer text-sm font-semibold text-admin-ink">{titulo}</summary>
      <div className="mt-3 flex flex-col gap-2">{children}</div>
    </details>
  );
}
