"use client";

import Link from "next/link";
import { useSession } from "@/lib/session-context";
import { ALL_NAV_ITEMS } from "../nav-items";
import Card from "../_components/Card";

// Una línea por tarjeta — los labels ya vienen de ALL_NAV_ITEMS (mismo
// título que el <h2> de cada sección), esto solo agrega el subtítulo.
const DESCRIPCIONES: Record<string, string> = {
  "/dashboard/ajustes/negocio": "Mensaje de bienvenida, horario y ubicación",
  "/dashboard/ajustes/equipo": "Administra los usuarios que trabajan en tu negocio",
  "/dashboard/ajustes/facturacion": "Define si tus clientes pueden pedir factura",
  "/dashboard/ajustes/pagos": "Conecta Stripe para cobrar con tarjeta",
  "/dashboard/ajustes/bot": "Conecta el bot de WhatsApp con tu catálogo",
  "/dashboard/ajustes/envios": "Zonas de entrega a domicilio y pedido mínimo",
  "/dashboard/ajustes/pedidos-b2b": "Rango semanal en el que aceptas pedidos de mayoreo",
  "/dashboard/ajustes/codigos-descuento": "Códigos con % de descuento para tus pedidos de mayoreo",
};

interface Grupo {
  titulo: string;
  hrefs: string[];
}

const GRUPOS: Grupo[] = [
  { titulo: "Negocio", hrefs: ["/dashboard/ajustes/negocio", "/dashboard/ajustes/equipo"] },
  {
    titulo: "Administración",
    hrefs: ["/dashboard/ajustes/facturacion", "/dashboard/ajustes/pagos", "/dashboard/ajustes/bot"],
  },
  { titulo: "Envíos", hrefs: ["/dashboard/ajustes/envios"] },
];

// Solo se agrega si el tenant es RETAIL_B2B — mismo gate que ya usaba la
// sección de ventana de recepción dentro de la página vieja de Configuración.
const GRUPO_PEDIDOS_B2B: Grupo = {
  titulo: "Pedidos B2B",
  hrefs: ["/dashboard/ajustes/pedidos-b2b", "/dashboard/ajustes/codigos-descuento"],
};

export default function AjustesPage() {
  const { user } = useSession();

  if (user.rol !== "DUENO") {
    return <p className="text-sm text-admin-ink-soft">Solo el dueño del negocio puede editar los ajustes.</p>;
  }

  const grupos = user.tenant.tipoStorefront === "RETAIL_B2B" ? [...GRUPOS, GRUPO_PEDIDOS_B2B] : GRUPOS;

  return (
    <div className="flex flex-col gap-7">
      {grupos.map((grupo) => (
        <section key={grupo.titulo} className="flex flex-col gap-3">
          <h2 className="text-xs font-extrabold uppercase tracking-wide text-admin-ink-soft">{grupo.titulo}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {grupo.hrefs.map((href) => {
              const item = ALL_NAV_ITEMS.find((navItem) => navItem.href === href);
              if (!item) return null;
              return (
                <Link key={href} href={href}>
                  <Card className="flex items-center gap-3 transition hover:shadow-md" padding={16}>
                    <span
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-admin-control)] text-xl"
                      style={{ backgroundColor: item.iconBg, color: item.iconColor }}
                    >
                      {item.emoji}
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="text-sm font-bold text-admin-ink">{item.label}</span>
                      <span className="truncate text-xs text-admin-ink-soft">{DESCRIPCIONES[href]}</span>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
