"use client";

import { usePathname } from "next/navigation";
import { ALL_NAV_ITEMS } from "./nav-items";

export default function DashboardTopbar() {
  const pathname = usePathname();
  const current = ALL_NAV_ITEMS.find((item) => item.href === pathname);
  const title = current?.label ?? "Aelika";

  return (
    <header className="flex shrink-0 flex-col justify-center gap-1 border-b border-admin-border bg-white px-8 py-4 font-admin">
      <div className="flex items-center gap-2">
        {current && (
          <span
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-admin-control)] text-sm"
            style={{ backgroundColor: current.iconBg, color: current.iconColor }}
          >
            {current.emoji}
          </span>
        )}
        <span className="text-[13px] font-semibold text-admin-ink-soft">{title}</span>
      </div>
      <h1 className="text-[28px] font-bold text-admin-ink">{title}</h1>
    </header>
  );
}
