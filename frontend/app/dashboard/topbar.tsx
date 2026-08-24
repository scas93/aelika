"use client";

import { usePathname } from "next/navigation";
import { ALL_NAV_ITEMS } from "./nav-items";

export default function DashboardTopbar() {
  const pathname = usePathname();
  const current = ALL_NAV_ITEMS.find((item) => item.href === pathname);
  const title = current?.label ?? "Aelika";

  return (
    <header className="flex shrink-0 flex-col justify-center border-b border-admin-border bg-white px-8 py-4 font-admin">
      <h1 className="text-[28px] font-bold text-admin-ink">{title}</h1>
    </header>
  );
}
