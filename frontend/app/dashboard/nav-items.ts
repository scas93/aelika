import type { Role, TipoStorefront } from "@/lib/api";
import {
  IconBell,
  IconBuildingStore,
  IconClipboardList,
  IconClock,
  IconCreditCard,
  IconHistory,
  IconHome,
  IconKey,
  IconPackage,
  IconReceipt2,
  IconRobot,
  IconSettings,
  IconSpeakerphone,
  IconTag,
  IconTarget,
  IconTruckDelivery,
  IconUsers,
  type Icon,
} from "@tabler/icons-react";

export interface NavItem {
  href: string;
  label: string;
  // Ícono monocromático de @tabler/icons-react — reemplaza al emoji +
  // iconBg/iconColor por item que usaba el sidebar oscuro (ver
  // globals.css/nav.tsx, rediseño a fondo claro). Sin chip de color
  // individual: el ícono se pinta con currentColor, hereda el color de
  // texto de la fila (ink-soft normal, acento cuando la fila está activa).
  icon: Icon;
  // Primer precedente de nav anidada en el proyecto (Módulo 3, reestructura)
  // — antes ninguna entrada tenía esto. Un item con `children` se renderiza
  // en el sidebar como encabezado no clickeable + sus hijos indentados
  // debajo (ver DashboardNav) — siempre expandido, sin estado de
  // colapsar/expandir (decisión deliberada para no sumar complejidad de
  // UI que nadie pidió). Un item con `children` normalmente no tiene una
  // página propia detrás de su `href` (ver /dashboard/notificaciones,
  // que solo redirige al primer hijo).
  children?: NavItem[];
}

// Single source of truth for both the sidebar (role-filtered) and the
// topbar (unfiltered — it only needs a title for whatever route is
// current, not to gate access). Los hijos de un item con `children` viven
// anidados aquí (no aplanados) — topbar.tsx busca recursivo para resolver
// título, ver buscarPorHref. El ícono de las subrutas de /ajustes y
// /notificaciones/*/nueva nunca se pinta en ningún lado hoy (topbar solo usa
// `label`, y estas rutas están ocultas del sidebar, ver
// HREFS_OCULTOS_DEL_SIDEBAR) — se les asigna uno de cualquier forma porque
// el campo es obligatorio en el tipo, no porque se vaya a usar.
export const ALL_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Inicio", icon: IconHome },
  { href: "/dashboard/pedidos", label: "Pedidos", icon: IconReceipt2 },
  { href: "/dashboard/pedidos/historico", label: "Histórico", icon: IconHistory },
  { href: "/dashboard/pagos", label: "Pagos", icon: IconCreditCard },
  // Solo RETAIL_B2B (ver getNavItems abajo).
  { href: "/dashboard/pedidos-b2b", label: "Pedidos activos", icon: IconPackage },
  { href: "/dashboard/pedidos-b2b/dia", label: "Pedidos del día", icon: IconTruckDelivery },
  { href: "/dashboard/pedidos-b2b/historico", label: "Históricos", icon: IconHistory },
  { href: "/dashboard/catalogo", label: "Catálogo", icon: IconClipboardList },
  { href: "/dashboard/clientes", label: "Clientes", icon: IconUsers },
  // Reemplaza la entrada plana "Reglas" (Etapa 3) — ahora como encabezado de
  // grupo con "Recontacto"/"Seguimiento" debajo (Módulo 3, reestructura).
  // `/dashboard/notificaciones` en sí no tiene page.tsx propio con contenido
  // — solo redirige al primer hijo (ver esa ruta), así que tampoco tiene
  // entrada aparte en HREFS_OCULTOS_DEL_SIDEBAR.
  {
    href: "/dashboard/notificaciones",
    label: "Notificaciones",
    icon: IconTarget,
    children: [
      // MARKETING — mensajes que buscan traer de vuelta a un cliente.
      { href: "/dashboard/notificaciones/recontacto", label: "Recontacto", icon: IconSpeakerphone },
      // UTILITY — avisos operativos ligados a un pedido/estatus.
      { href: "/dashboard/notificaciones/seguimiento", label: "Seguimiento", icon: IconBell },
    ],
  },
  { href: "/dashboard/ajustes", label: "Ajustes", icon: IconSettings },
  // Ya no es un ítem de sidebar (ver HREFS_OCULTOS_DEL_SIDEBAR abajo) — solo
  // se accede desde el menú de usuario al fondo del sidebar (UserMenu.tsx).
  // La entrada se conserva aquí para que topbar.tsx siga resolviendo su
  // título.
  { href: "/dashboard/cambiar-password", label: "Contraseña", icon: IconKey },

  // Subrutas de /dashboard/ajustes — nunca se muestran en el sidebar (ver
  // HREFS_OCULTOS_DEL_SIDEBAR abajo), solo existen aquí para que topbar.tsx
  // resuelva su título por match exacto de pathname.
  { href: "/dashboard/ajustes/negocio", label: "Información del negocio", icon: IconBuildingStore },
  { href: "/dashboard/ajustes/equipo", label: "Equipo", icon: IconUsers },
  { href: "/dashboard/ajustes/facturacion", label: "Facturación", icon: IconReceipt2 },
  { href: "/dashboard/ajustes/pagos", label: "Cobros con tarjeta", icon: IconCreditCard },
  { href: "/dashboard/ajustes/conexion-whatsapp", label: "Conexión WhatsApp", icon: IconRobot },
  { href: "/dashboard/ajustes/envios", label: "Puntos de envío", icon: IconTruckDelivery },
  { href: "/dashboard/ajustes/pedidos-b2b", label: "Ventana de recepción de pedidos", icon: IconClock },
  { href: "/dashboard/ajustes/codigos-descuento", label: "Códigos de descuento", icon: IconTag },
  { href: "/dashboard/ajustes/notificaciones", label: "Canales de notificación", icon: IconBell },

  // Subrutas de /dashboard/notificaciones/{recontacto,seguimiento} — mismo
  // motivo que las de /ajustes arriba (solo título de topbar).
  { href: "/dashboard/notificaciones/recontacto/nueva", label: "Nueva regla de recontacto", icon: IconSpeakerphone },
  { href: "/dashboard/notificaciones/seguimiento/nueva", label: "Nueva regla de seguimiento", icon: IconBell },
];

// Pedidos/Histórico/Pagos operan sobre Order (carrito + pago inmediato) y
// Payment (solo se llena vía webhook de Stripe atado a Order.metodoPago =
// TARJETA) — ninguno de los dos aplica al flujo de PedidoB2b (pedido semanal
// a crédito, confirmación de pago manual, sin Stripe). No es una lista
// temporal: cuando existan los módulos de "Pedidos activos"/"Pedidos del
// día"/"Históricos" propios de B2B (fase futura), se agregan aparte —
// ocultar estos tres no es lo mismo que ya tener sus reemplazos.
const HREFS_NO_APLICAN_A_RETAIL_B2B = new Set([
  "/dashboard/pedidos",
  "/dashboard/pedidos/historico",
  "/dashboard/pagos",
]);

// Inverso del set de arriba — módulos propios de B2B que no aplican a
// RETAIL_B2C (opera sobre PedidoB2b, que un tenant B2C nunca genera).
const HREFS_SOLO_RETAIL_B2B = new Set([
  "/dashboard/pedidos-b2b",
  "/dashboard/pedidos-b2b/dia",
  "/dashboard/pedidos-b2b/historico",
]);

// Rutas que existen en ALL_NAV_ITEMS solo para el título de la topbar (ver
// comentario arriba), nunca como link propio en el sidebar — subrutas de
// /dashboard/ajustes (navegación vía tarjetas, no sidebar),
// /dashboard/notificaciones/{recontacto,seguimiento}/nueva (navegación vía
// botón dentro del listado, no sidebar), y /dashboard/cambiar-password
// (navegación vía el menú de usuario del sidebar, ver UserMenu.tsx). Ocultas
// sin importar rol/tipoStorefront — cada ruta hace su propio gate de acceso
// en su page.tsx, independiente de si el link es visible aquí.
const HREFS_OCULTOS_DEL_SIDEBAR = new Set([
  "/dashboard/cambiar-password",
  "/dashboard/ajustes/negocio",
  "/dashboard/ajustes/equipo",
  "/dashboard/ajustes/facturacion",
  "/dashboard/ajustes/pagos",
  "/dashboard/ajustes/conexion-whatsapp",
  "/dashboard/ajustes/envios",
  "/dashboard/ajustes/pedidos-b2b",
  "/dashboard/ajustes/codigos-descuento",
  "/dashboard/ajustes/notificaciones",
  "/dashboard/notificaciones/recontacto/nueva",
  "/dashboard/notificaciones/seguimiento/nueva",
]);

export function getNavItems(rol: Role, tipoStorefront: TipoStorefront): NavItem[] {
  return ALL_NAV_ITEMS.filter((item) => {
    if (HREFS_OCULTOS_DEL_SIDEBAR.has(item.href)) return false;
    if (item.href === "/dashboard") return rol === "GERENTE" || rol === "DUENO";
    if (item.href === "/dashboard/catalogo") return rol !== "OPERADOR";
    if (item.href === "/dashboard/clientes") return rol === "GERENTE" || rol === "DUENO";
    if (item.href === "/dashboard/ajustes") return rol === "DUENO";
    if (item.href === "/dashboard/notificaciones") return rol === "DUENO";
    if (tipoStorefront === "RETAIL_B2B" && HREFS_NO_APLICAN_A_RETAIL_B2B.has(item.href)) return false;
    if (tipoStorefront !== "RETAIL_B2B" && HREFS_SOLO_RETAIL_B2B.has(item.href)) return false;
    return true;
  });
}

// Búsqueda recursiva (padre + hijos) — usada por topbar.tsx para resolver el
// título de cualquier ruta, incluyendo las anidadas bajo "Notificaciones".
export function buscarPorHref(items: NavItem[], href: string): NavItem | undefined {
  for (const item of items) {
    if (item.href === href) return item;
    if (item.children) {
      const enHijos = buscarPorHref(item.children, href);
      if (enHijos) return enHijos;
    }
  }
  return undefined;
}
