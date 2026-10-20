import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "danger";
type Size = "xs" | "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  // Acento interactivo — ya no admin-green (ver globals.css: admin-green
  // pasó a significar exclusivamente "éxito").
  primary: "bg-admin-accent text-white hover:bg-admin-accent-dark",
  // Rectangular (mismo radio que primary), borde neutro, fondo blanco y texto oscuro; con size="xs" es la versión compacta con ícono.
  secondary: "border border-admin-border bg-white text-admin-ink hover:bg-admin-bg",
  danger:
    "border border-admin-red-soft bg-white text-admin-red hover:bg-admin-red-soft disabled:border-admin-border disabled:text-admin-ink-soft disabled:hover:bg-transparent",
};

const SIZE_CLASSES: Record<Size, string> = {
  // Alto de 20px: no supera la línea de un título de sección (text-sm). Con ícono: gap entre ícono y texto.
  xs: "inline-flex h-5 items-center gap-1 px-2 text-xs",
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-sm",
};

// Replaces the BTN_PRIMARY/BTN_SECONDARY/BTN_DANGER string constants
// duplicated across ~12 files under /dashboard.
//
// `onDark` (el restyle de "secondary" para fondo oscuro) se eliminó en el
// rediseño del sidebar a fondo claro — era exclusivamente para el botón fijo
// "Cerrar sesión" de nav.tsx, que ya no existe (se movió dentro de
// UserMenu). Sin ningún otro consumidor en la app, se quitó en vez de
// dejarse sin uso — decisión explícita de este cambio, repórtese si se
// prefería conservarlo.
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", fullWidth = false, className = "", ...props },
  ref,
) {
  const variantClasses = VARIANT_CLASSES[variant];
  return (
    <button
      ref={ref}
      className={`max-md:min-h-10 rounded-[var(--radius-admin-control)] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${variantClasses} ${SIZE_CLASSES[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
});

export default Button;
