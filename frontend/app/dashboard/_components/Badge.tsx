import { ReactNode } from "react";

interface BadgeProps {
  // Full class list for background + text color (e.g. "bg-gray-500
  // text-white" for a solid pill, or "bg-admin-green-soft
  // text-admin-green-dark" for a soft one) — callers own the palette
  // entirely, this component only owns the pill shape.
  color: string;
  children: ReactNode;
}

// Generic pill badge — the color mapping (e.g. pedidos/estado.ts's
// ESTADO_COLOR, or a promotion/modifier type) stays owned by whichever
// screen needs it, so this component has no knowledge of any specific
// domain.
export default function Badge({ color, children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-[var(--radius-admin-pill)] px-2.5 py-1 text-xs font-bold ${color}`}>
      {children}
    </span>
  );
}
