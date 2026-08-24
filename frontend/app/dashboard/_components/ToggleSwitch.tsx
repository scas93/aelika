interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  label: string;
}

// Extracted from catalogo/page.tsx (same behavior/markup, no functional
// change) — not yet wired back into catalogo or puntos-envio-section, see
// CLAUDE.md phase notes.
export default function ToggleSwitch({ checked, onChange, label }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-[22px] w-10 shrink-0 rounded-full transition ${checked ? "bg-admin-green" : "bg-black/15"}`}
    >
      <span
        className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition ${
          checked ? "left-[20px]" : "left-0.5"
        }`}
      />
    </button>
  );
}
