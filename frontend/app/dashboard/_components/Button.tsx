import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  // Acento interactivo — ya no admin-green (ver globals.css: admin-green
  // pasó a significar exclusivamente "éxito").
  primary: "bg-admin-accent text-white hover:bg-admin-accent-dark",
  secondary: "border border-admin-border bg-white text-admin-ink-soft hover:bg-admin-bg",
  danger:
    "border border-admin-red-soft bg-white text-admin-red hover:bg-admin-red-soft disabled:border-admin-border disabled:text-admin-ink-soft disabled:hover:bg-transparent",
};

const SIZE_CLASSES: Record<Size, string> = {
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
      className={`rounded-[var(--radius-admin-control)] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${variantClasses} ${SIZE_CLASSES[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
});

export default Button;
