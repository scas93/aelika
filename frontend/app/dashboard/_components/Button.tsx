import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  // Restyles the "secondary" variant for use on a dark background (e.g. the
  // sidebar) — white text/border instead of the light-panel defaults. No
  // effect on primary/danger, which already have enough contrast on dark.
  onDark?: boolean;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-admin-green text-white hover:bg-admin-green-dark",
  secondary: "border border-admin-border bg-white text-admin-ink-soft hover:bg-admin-bg",
  danger:
    "border border-red-200 bg-white text-red-600 hover:bg-red-50 disabled:border-admin-border disabled:text-admin-ink-soft disabled:hover:bg-transparent",
};

const SECONDARY_ON_DARK_CLASSES = "border border-white/15 bg-white/10 text-white hover:bg-white/15";

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-sm",
};

// Replaces the BTN_PRIMARY/BTN_SECONDARY/BTN_DANGER string constants
// duplicated across ~12 files under /dashboard. Not wired into any of
// those screens yet — Login is the first consumer (see CLAUDE.md phase
// notes for the rollout order).
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", fullWidth = false, onDark = false, className = "", ...props },
  ref,
) {
  const variantClasses = onDark && variant === "secondary" ? SECONDARY_ON_DARK_CLASSES : VARIANT_CLASSES[variant];
  return (
    <button
      ref={ref}
      className={`rounded-[var(--radius-admin-control)] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${variantClasses} ${SIZE_CLASSES[size]} ${fullWidth ? "w-full" : ""} ${className}`}
      {...props}
    />
  );
});

export default Button;
