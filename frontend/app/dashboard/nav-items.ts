import type { Role, TipoStorefront } from "@/lib/api";

export interface NavItem {
  href: string;
  label: string;
  emoji: string;
  // Per-section accent pair for the sidebar/topbar icon badge — soft
  // background + saturated icon color, one distinct pair per section.
  iconBg: string;
  iconColor: string;
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
// título, ver buscarPorHref.
export const ALL_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Inicio", emoji: "🏠", iconBg: "#DBEAFE", iconColor: "#3B82F6" },
  { href: "/dashboard/pedidos", label: "Pedidos", emoji: "🧾", iconBg: "#FEF3C7", iconColor: "#F59E0B" },
  { href: "/dashboard/pedidos/historico", label: "Histórico", emoji: "📜", iconBg: "#FEF3C7", iconColor: "#F59E0B" },
  { href: "/dashboard/pagos", label: "Pagos", emoji: "💳", iconBg: "#DCFCE7", iconColor: "#16A34A" },
  // Solo RETAIL_B2B (ver getNavItems abajo) — mismo tono ámbar que usa el
  // storefront público /mayoreo/[slug] (--color-mayoreo-accent), para que
  // ambas superficies del módulo B2B se sientan como la misma cosa.
  { href: "/dashboard/pedidos-b2b", label: "Pedidos activos", emoji: "📦", iconBg: "#FEF3E2", iconColor: "#B45309" },
  { href: "/dashboard/pedidos-b2b/dia", label: "Pedidos del día", emoji: "🚚", iconBg: "#FEF3E2", iconColor: "#B45309" },
  { href: "/dashboard/pedidos-b2b/historico", label: "Históricos", emoji: "📜", iconBg: "#FEF3E2", iconColor: "#B45309" },
  { href: "/dashboard/catalogo", label: "Catálogo", emoji: "📋", iconBg: "#EDE9FE", iconColor: "#8B5CF6" },
  { href: "/dashboard/clientes", label: "Clientes", emoji: "👤", iconBg: "#FFE4E6", iconColor: "#E11D48" },
  // Reemplaza la entrada plana "Reglas" (Etapa 3) — mismo rojo que antes,
  // ahora como encabezado de grupo con "Recontacto"/"Seguimiento" debajo
  // (Módulo 3, reestructura). `/dashboard/notificaciones` en sí no tiene
  // page.tsx propio con contenido — solo redirige al primer hijo (ver esa
  // ruta), así que tampoco tiene entrada aparte en HREFS_OCULTOS_DEL_SIDEBAR.
  {
    href: "/dashboard/notificaciones",
    label: "Notificaciones",
    emoji: "🎯",
    iconBg: "#FEE2E2",
    iconColor: "#B91C1C",
    children: [
      // MARKETING — mensajes que buscan traer de vuelta a un cliente.
      { href: "/dashboard/notificaciones/recontacto", label: "Recontacto", emoji: "📣", iconBg: "#FCE7F3", iconColor: "#EC4899" },
      // UTILITY — avisos operativos ligados a un pedido/estatus.
      { href: "/dashboard/notificaciones/seguimiento", label: "Seguimiento", emoji: "🔔", iconBg: "#DBEAFE", iconColor: "#3B82F6" },
    ],
  },
  { href: "/dashboard/ajustes", label: "Ajustes", emoji: "⚙️", iconBg: "#E2E8F0", iconColor: "#64748B" },
  // Ya no es un ítem de sidebar (ver HREFS_OCULTOS_DEL_SIDEBAR abajo) — solo
  // se accede desde el menú "Mi perfil" en el topbar (UserMenu.tsx). La
  // entrada se conserva aquí para que topbar.tsx siga resolviendo su título.
  { href: "/dashboard/cambiar-password", label: "Contraseña", emoji: "🔑", iconBg: "#CCFBF1", iconColor: "#14B8A6" },

  // Subrutas de /dashboard/ajustes — nunca se muestran en el sidebar (ver
  // HREFS_OCULTOS_DEL_SIDEBAR abajo), solo existen aquí para que topbar.tsx
  // resuelva su título por match exacto de pathname. Los labels replican el
  // <h2> de cada sección (facturacion-section.tsx, stripe-section.tsx, etc.)
  // para que el título de la topbar y el encabezado de la tarjeta coincidan.
  { href: "/dashboard/ajustes/negocio", label: "Información del negocio", emoji: "🏪", iconBg: "#E0E7FF", iconColor: "#4F46E5" },
  // Mismo emoji/colores que ya tenía la entrada de primer nivel "Equipo"
  // antes de moverse aquí — mismo contenido, solo cambió dónde vive.
  { href: "/dashboard/ajustes/equipo", label: "Equipo", emoji: "👥", iconBg: "#FCE7F3", iconColor: "#EC4899" },
  { href: "/dashboard/ajustes/facturacion", label: "Facturación", emoji: "🧾", iconBg: "#FEF3C7", iconColor: "#F59E0B" },
  { href: "/dashboard/ajustes/pagos", label: "Cobros con tarjeta", emoji: "💳", iconBg: "#DCFCE7", iconColor: "#16A34A" },
  // Reemplaza "/dashboard/ajustes/bot" ("Llave del bot") — ahora junta
  // botApiKey + botWebhookUrl/Secret + umbral del candado, las 3 cosas que
  // le importan a la relación con Botpress (Módulo 3, reestructura).
  { href: "/dashboard/ajustes/conexion-whatsapp", label: "Conexión WhatsApp", emoji: "🤖", iconBg: "#E0F2FE", iconColor: "#0284C7" },
  { href: "/dashboard/ajustes/envios", label: "Puntos de envío", emoji: "🚚", iconBg: "#D1FAE5", iconColor: "#059669" },
  { href: "/dashboard/ajustes/pedidos-b2b", label: "Ventana de recepción de pedidos", emoji: "⏰", iconBg: "#FEF3E2", iconColor: "#B45309" },
  { href: "/dashboard/ajustes/codigos-descuento", label: "Códigos de descuento", emoji: "🏷️", iconBg: "#FEF3E2", iconColor: "#B45309" },
  // Sistema viejo (Telegram/Correo, NotificacionCanalConfig/NotificacionEventoConfig)
  // — solo el label visible cambió, para no chocar con el módulo nuevo de
  // arriba ni con "Conexión WhatsApp"; la ruta y la lógica siguen iguales.
  { href: "/dashboard/ajustes/notificaciones", label: "Canales de notificación", emoji: "🔔", iconBg: "#FEE2E2", iconColor: "#DC2626" },

  // Subrutas de /dashboard/notificaciones/{recontacto,seguimiento} — mismo
  // motivo que las de /ajustes arriba (solo título de topbar). Los "[id]"
  // (editar) no tienen entrada aquí por la misma razón que
  // /dashboard/catalogo/productos/[id] nunca la tuvo: un id no se puede
  // matchear de forma estática, cae al fallback "Aelika" del topbar, la
  // propia página ya trae su encabezado.
  { href: "/dashboard/notificaciones/recontacto/nueva", label: "Nueva regla de recontacto", emoji: "📣", iconBg: "#FCE7F3", iconColor: "#EC4899" },
  { href: "/dashboard/notificaciones/seguimiento/nueva", label: "Nueva regla de seguimiento", emoji: "🔔", iconBg: "#DBEAFE", iconColor: "#3B82F6" },
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
// (navegación vía el menú "Mi perfil" del topbar, ver UserMenu.tsx). Ocultas
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
