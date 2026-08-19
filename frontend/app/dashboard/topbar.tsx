"use client";

import { usePathname } from "next/navigation";
import { ALL_NAV_ITEMS } from "./nav-items";

export default function DashboardTopbar() {
  const pathname = usePathname();
  const current = ALL_NAV_ITEMS.find((item) => item.href === pathname);

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-black/10 bg-white px-5 font-admin">
      <h1 className="text-[15px] font-bold text-admin-ink">{current?.label ?? "Aelika"}</h1>
    </header>
  );
}
