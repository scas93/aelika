import { ReactNode } from "react";

// Variantes semánticas FIJAS: el color de un badge de estado significa lo mismo en todo el panel.
//   advertencia (ámbar) — requiere que alguien haga algo
//   info (azul)         — en curso
//   exito (verde)       — terminado bien
//   peligro (rojo)      — terminado mal
//   neutro (gris)       — normal, sin alerta
//   oscuro (gris oscuro)— solo «Reembolsado»
// Pill suave (fondo tenue + texto en el tono oscuro del mismo color), sin borde. El teal (admin-accent) NO se usa en badges:
// queda para acciones (botones, nav activo, foco). El vocabulario de cada dominio (qué estado es qué variante) vive en el
// mapeo estado→variante de cada módulo (ver pedidos/estado.ts, pedidos-b2b/estado.ts), no aquí.
export type BadgeVariant = "advertencia" | "info" | "exito" | "peligro" | "neutro" | "oscuro";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  advertencia: "bg-amber-100 text-amber-800",
  info: "bg-blue-100 text-blue-800",
  exito: "bg-admin-green-soft text-admin-green-dark",
  peligro: "bg-admin-red-soft text-admin-red-dark",
  neutro: "bg-gray-100 text-gray-600",
  oscuro: "bg-slate-300 text-slate-800",
};

// Ancho mínimo por TIPO de estado, SOLO para columnas de tabla (y la lista de estados del Dashboard): fuera de ahí (tarjetas,
// paneles, encabezados) el badge mide lo que su texto. Marcado por su texto más largo (en `ch`, + el padding horizontal px-2.5 = 1.25rem) para que
// en una columna de tabla todos los badges de ese tipo midan igual. Los `ch` están calibrados contra el texto real en text-xs
// font-bold (incluyen el punto de 6px y su separación; ~0.75ch por carácter con font-medium): si cambia el texto más largo de un tipo, hay que recalibrarlo aquí.
//   pedidoB2c  «Confirmado y surtiendo» (22)      pedidoB2b «Por confirmar» (13)
//   pago       «Pago no completado» (18)          pagoB2b   «Pendiente» (9; B2B solo tiene Pendiente y Pagado)
//   entrega    «No recogida» (11)
export type AnchoBadge = "pedidoB2c" | "pedidoB2b" | "pago" | "pagoB2b" | "entrega";

const ANCHO_CLASSES: Record<AnchoBadge, string> = {
  pedidoB2c: "max-md:min-w-0 min-w-[calc(19.3ch_+_1.25rem)]",
  pedidoB2b: "max-md:min-w-0 min-w-[calc(11.9ch_+_1.25rem)]",
  pago: "max-md:min-w-0 min-w-[calc(17ch_+_1.25rem)]",
  pagoB2b: "max-md:min-w-0 min-w-[calc(9.5ch_+_1.25rem)]",
  entrega: "max-md:min-w-0 min-w-[calc(10.8ch_+_1.25rem)]",
};

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  // Escape hatch para badges categóricos (no de estado) que necesitan más matices que las variantes semánticas — ej. tipo de
  // modificador (Única/Múltiple), tipo de promoción (%/monto fijo/combo), trigger de una regla de notificación. Mutuamente
  // excluyente con `variant` — pasar ambos usa `variant`.
  color?: string;
  // Ancho mínimo fijo del tipo de estado (ver arriba). Sin él, el ancho es el del contenido.
  ancho?: AnchoBadge;
}

// Todos los badges: misma altura (h-5), texto de 12px de peso medio, centrado y sin salto de línea. Los de estado (`variant`) llevan
// un punto de 6px del color del texto antes del texto; los categóricos (`color`) no.
export default function Badge({ children, variant, color, ancho }: BadgeProps) {
  const classes = variant ? VARIANT_CLASSES[variant] : (color ?? VARIANT_CLASSES.neutro);
  return (
    <span
      className={`inline-flex h-5 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-admin-pill)] px-2.5 text-xs font-medium ${ancho ? ANCHO_CLASSES[ancho] : ""} ${classes}`}
    >
      {variant && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}
