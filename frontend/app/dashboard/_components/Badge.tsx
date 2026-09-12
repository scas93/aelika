import { ReactNode } from "react";

// 6 variantes semánticas fijas — pill suave (fondo tenue + texto en el tono
// oscuro del mismo color), mismo patrón que ya usaban los tokens
// admin-green-soft/admin-green-dark y que ya usan los badges categóricos del
// escape hatch `color` (ver abajo) — con este cambio ambos grupos quedan
// visualmente consistentes entre sí. exito/peligro/acento usan sus propios
// tokens *-soft/*-dark (ya existían o se agregaron para esto, se reusan
// también en botones/foco de inputs). advertencia/neutro/oscuro no se
// comparten fuera de Badge, así que van con Tailwind crudo local en vez de
// agregar tokens de un solo consumidor — mismo criterio que el resto del
// proyecto usa para decidir cuándo algo se vuelve token.
//
// "oscuro" es deliberadamente genérico ("énfasis fuerte", no "completado"/
// "despachado") — Badge es un componente de sistema, el vocabulario
// específico de cada dominio vive en el mapeo estado→variante de cada
// módulo (ver pedidos/estado.ts), no aquí. En tinte suave, "oscuro" necesita
// más peso que "neutro" para seguir distinguiéndose (mismo criterio del
// prompt de esta corrección): tinte slate más saturado + borde, en vez del
// mismo gris claro sin borde de "neutro".
export type BadgeVariant = "exito" | "advertencia" | "peligro" | "neutro" | "oscuro" | "acento";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  exito: "bg-admin-green-soft text-admin-green-dark",
  advertencia: "bg-amber-100 text-amber-800",
  peligro: "bg-admin-red-soft text-admin-red-dark",
  neutro: "bg-gray-100 text-gray-600",
  oscuro: "bg-slate-300 text-slate-800 border border-slate-400",
  acento: "bg-admin-accent-soft text-admin-accent-dark",
};

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  // Escape hatch para badges categóricos (no de estatus) que necesitan más
  // matices que las 6 variantes semánticas de arriba — ej. tipo de
  // modificador (Única/Múltiple), tipo de promoción (%/monto fijo/combo),
  // trigger de una regla de notificación. Esos casos distinguen categorías
  // sin orden/jerarquía entre sí (no "mejor o peor"), así que forzarlos a
  // "acento" perdería la distinción visual que hoy tienen entre 3-4 tipos.
  // Mutuamente excluyente con `variant` — pasar ambos usa `variant`.
  color?: string;
}

export default function Badge({ children, variant, color }: BadgeProps) {
  const classes = variant ? VARIANT_CLASSES[variant] : (color ?? VARIANT_CLASSES.neutro);
  return (
    <span className={`inline-flex items-center rounded-[var(--radius-admin-pill)] px-2.5 py-1 text-xs font-bold ${classes}`}>
      {children}
    </span>
  );
}
