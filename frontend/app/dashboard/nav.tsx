"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session-context";
import { getNavItems } from "./nav-items";
import Button from "./_components/Button";

export default function DashboardNav() {
  const { user, logout } = useSession();
  const pathname = usePathname();
  const items = getNavItems(user.rol);
  const tenantInitial = user.tenant.nombre.trim().charAt(0).toUpperCase();

  return (
    <aside className="flex w-[224px] shrink-0 flex-col bg-admin-sidebar font-admin">
      <div className="flex items-center gap-3 border-b border-white/10 p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-admin-control)] bg-admin-green text-sm font-bold text-white">
          {tenantInitial}
        </div>
        <div className="flex flex-col overflow-hidden">
          <p className="truncate text-[15px] font-semibold text-white">{user.tenant.nombre}</p>
          <p className="text-[13px] text-white/60">Panel administrativo</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex h-11 items-center gap-3 rounded-md border-l-[3px] px-4 transition ${
                active ? "border-admin-green bg-white/8" : "border-transparent hover:bg-white/5"
              }`}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-admin-control)] text-sm"
                style={{ backgroundColor: item.iconBg, color: item.iconColor }}
              >
                {item.emoji}
              </span>
              <span className={active ? "text-[15px] font-semibold text-white" : "text-[15px] text-white/80"}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3">
        <Button variant="secondary" onDark fullWidth onClick={logout}>
          Cerrar sesión
        </Button>
      </div>
    </aside>
  );
}
