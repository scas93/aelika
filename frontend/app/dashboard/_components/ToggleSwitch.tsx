interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}

// admin-green a propósito en el estado "on" — se lee como "activo/
// disponible" (un estado, no un acento de interacción), mismo criterio que
// Badge variante "exito". No se migró a admin-accent en el prompt de
// unificación de tokens; encontrado por grep y documentado aquí.
export default function ToggleSwitch({ checked, onChange, label, disabled = false }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`relative h-[22px] w-10 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-admin-green" : "bg-black/15"}`}
    >
      <span
        className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition ${
          checked ? "left-[20px]" : "left-0.5"
        }`}
      />
    </button>
  );
}
