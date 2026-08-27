"use client";

import { usePathname } from "next/navigation";
import { ALL_NAV_ITEMS } from "./nav-items";
import UserMenu from "./_components/UserMenu";

interface DashboardTopbarProps {
  onOpenSidebar: () => void;
}

export default function DashboardTopbar({ onOpenSidebar }: DashboardTopbarProps) {
  const pathname = usePathname();
  const current = ALL_NAV_ITEMS.find((item) => item.href === pathname);
  const title = current?.label ?? "Aelika";

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-admin-border bg-white px-4 py-4 font-admin md:px-8">
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label="Abrir menú"
        className="text-2xl leading-none text-admin-ink-soft transition hover:text-admin-ink md:hidden"
      >
        ☰
      </button>
      <h1 className="text-[28px] font-bold text-admin-ink">{title}</h1>
      <UserMenu />
    </header>
  );
}
