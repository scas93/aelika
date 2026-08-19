"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { getNavItems } from "./nav-items";

export default function DashboardNav() {
  const { user, logout } = useSession();
  const pathname = usePathname();
  const items = getNavItems(user.rol);

  return (
    <aside className="flex w-[210px] shrink-0 flex-col bg-admin-sidebar px-3 py-5 font-admin">
      <div className="mb-6 px-2.5">
        <p className="text-sm font-extrabold text-white">{user.tenant.nombre}</p>
        <p className="text-xs font-medium text-white/50">Panel administrativo</p>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                active
                  ? "flex items-center gap-2 rounded-md border-l-[3px] border-admin-green bg-admin-green/15 px-2.5 py-2 text-[13.5px] font-bold text-white"
                  : "flex items-center gap-2 rounded-md border-l-[3px] border-transparent px-2.5 py-2 text-[13.5px] font-bold text-white/60 transition hover:bg-white/5"
              }
            >
              <span>{item.emoji}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <button
        onClick={logout}
        className="mt-auto rounded-md border border-white/10 px-2.5 py-2 text-left text-[13.5px] font-bold text-white/70 transition hover:bg-white/5"
      >
        Cerrar sesión
      </button>
    </aside>
  );
}
