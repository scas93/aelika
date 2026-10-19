// Analítica de producto (PostHog) SOLO para el portal de clientes de mayoreo (/mayoreo/[slug]/...).
//
// Garantías de diseño:
//  · Sin NEXT_PUBLIC_POSTHOG_KEY no se inicializa nada: cero llamadas de red (local y staging no envían por defecto).
//  · Nunca rompe ni retrasa el portal: posthog-js se carga con import dinámico (no entra en el bundle inicial), cada
//    función es "dispara y olvida" y traga cualquier error (adblock, red caída, script bloqueado).
//  · Solo eventos explícitos: autocapture, heatmaps, pageviews automáticos, web vitals y encuestas, apagados.
//  · Propiedades permitidas: slug, semana (lunes YYYY-MM-DD), dias, piezas. Nunca teléfono, OTP, nombres, notas ni montos.
//  · Grabación de sesiones con todos los inputs enmascarados (teléfono, código, nota, búsqueda).
import type { PostHog } from "posthog-js";

export type EventoPortal =
  | "portal_visto"
  | "codigo_solicitado"
  | "otp_verificado"
  | "otp_fallido"
  | "cliente_elegido"
  | "catalogo_visto"
  | "producto_agregado"
  | "resumen_visto"
  | "pedido_confirmado"
  | "pedido_modificado";

export interface PropiedadesEvento {
  slug?: string;
  /** Lunes de la semana del pedido, YYYY-MM-DD. */
  semana?: string;
  dias?: number;
  piezas?: number;
}

const CLAVES_PERMITIDAS = ["slug", "semana", "dias", "piezas"] as const;

const TOKEN = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

let cliente: PostHog | null = null;
let iniciando: Promise<void> | null = null;
// Acciones recibidas antes de que termine de cargar el script: se ejecutan en orden al estar listo.
const pendientes: Array<(ph: PostHog) => void> = [];
let clienteIdentificado: string | null = null;

/** El folio viaja en la URL (/pedidos/P-000123); no debe llegar a PostHog ni en la URL de cada evento. */
export function limpiarUrl(url: unknown): unknown {
  return typeof url === "string"
    ? url.replace(/(\/pedidos\/)[^/?#]+/, "$1:folio")
    : url;
}

function iniciar(): void {
  if (!TOKEN || typeof window === "undefined" || iniciando) return;
  iniciando = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(TOKEN, {
        api_host: HOST,
        defaults: "2025-05-24",
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_performance: false,
        disable_surveys: true,
        person_profiles: "identified_only",
        session_recording: {
          maskAllInputs: true,
          recordBody: false,
          recordHeaders: false,
        },
        sanitize_properties: (props) => {
          for (const k of ["$current_url", "$pathname", "$referrer"]) {
            if (k in props) props[k] = limpiarUrl(props[k]);
          }
          return props;
        },
      });
      cliente = posthog;
      for (const accion of pendientes.splice(0)) {
        try {
          accion(posthog);
        } catch {
          // la analítica nunca interrumpe nada
        }
      }
    })
    .catch(() => {
      // Script bloqueado o fallo de carga: el portal sigue igual.
      pendientes.length = 0;
    });
}

function ejecutar(accion: (ph: PostHog) => void): void {
  if (!TOKEN || typeof window === "undefined") return;
  try {
    iniciar();
    if (cliente) accion(cliente);
    else pendientes.push(accion);
  } catch {
    // ignorado a propósito
  }
}

function soloPermitidas(props: PropiedadesEvento): PropiedadesEvento {
  const salida: Record<string, unknown> = {};
  for (const k of CLAVES_PERMITIDAS) {
    if (props[k] !== undefined) salida[k] = props[k];
  }
  return salida as PropiedadesEvento;
}

export function capturar(
  evento: EventoPortal,
  props: PropiedadesEvento = {},
): void {
  const limpias = soloPermitidas(props);
  ejecutar((ph) => ph.capture(evento, limpias));
}

/**
 * Asocia la sesión al id interno del Cliente (nunca teléfono ni nombre) y al negocio. Si ya había otro cliente
 * identificado, reinicia primero para no mezclar sesiones.
 */
export function identificarCliente(clienteId: string, slug: string): void {
  if (!TOKEN || clienteIdentificado === clienteId) return;
  const anterior = clienteIdentificado;
  clienteIdentificado = clienteId;
  ejecutar((ph) => {
    if (anterior) ph.reset();
    ph.identify(clienteId, { negocio: slug });
    ph.group("negocio", slug);
  });
}

/** Cierre de sesión o cambio de cliente: vuelve a anónimo. */
export function reiniciarIdentidad(): void {
  if (!TOKEN || clienteIdentificado === null) return;
  clienteIdentificado = null;
  ejecutar((ph) => ph.reset());
}
