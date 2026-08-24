import { ReactNode } from "react";

export interface TabItem {
  key: string;
  label: string;
  icon?: ReactNode;
}

interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (key: string) => void;
}

// Replaces the solid-pill TabButton duplicated in catalogo/page.tsx and
// pedidos/page.tsx — underline style instead. Not wired into either screen
// yet (see CLAUDE.md phase notes).
export default function Tabs({ items, active, onChange }: TabsProps) {
  return (
    <div className="flex gap-6 overflow-x-auto border-b border-admin-border">
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-bold transition ${
              isActive
                ? "border-admin-green text-admin-ink"
                : "border-transparent text-admin-ink-soft hover:text-admin-ink"
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
