import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "danger";
// Dos tamaños: `barra` (fila de controles de la página, 40 px) y `tabla` (dentro de tablas y paneles, 32 px; 40 px en teléfono).
// Los nombres anteriores siguen aceptándose como alias: xs/sm → tabla, md/lg → barra.
type Size = "barra" | "tabla" | "xs" | "sm" | "md" | "lg";

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

const BARRA = "inline-flex h-barra items-center justify-center gap-1.5 px-4 text-sm";
const TABLA = "inline-flex h-tabla items-center justify-center gap-1.5 px-3 text-xs";
const SIZE_CLASSES: Record<Size, string> = {
  barra: BARRA,
  tabla: TABLA,
  xs: TABLA,
  sm: TABLA,
  md: BARRA,
  lg: BARRA,
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
      className={`rounded-[var(--radius-admin-control)] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${variantClasses} ${SIZE_CLASSES[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
});

export default Button;
