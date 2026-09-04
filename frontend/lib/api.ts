const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type Role = "OPERADOR" | "GERENTE" | "DUENO";

export type DiaSemana = "lunes" | "martes" | "miercoles" | "jueves" | "viernes" | "sabado" | "domingo";

export const DIAS_SEMANA: DiaSemana[] = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

export interface HorarioDia {
  abierto: boolean;
  apertura: string | null;
  cierre: string | null;
}

export type HorarioSemana = Record<DiaSemana, HorarioDia>;

export function horarioSemanaVacio(): HorarioSemana {
  return DIAS_SEMANA.reduce((acc, dia) => {
    acc[dia] = { abierto: false, apertura: null, cierre: null };
    return acc;
  }, {} as HorarioSemana);
}

export interface Session {
  accessToken: string;
  user: {
    id: string;
    tenantId: string;
    email: string;
    rol: Role;
  };
}

// Lista extensible a propósito (no un booleano B2B/B2C) — se espera agregar
// más valores en el futuro, ligados a otras verticales de negocio. Ver
// TipoStorefront en el schema de Prisma y dashboard/nav-items.ts, que filtra
// la navegación según este valor.
export type TipoStorefront = "RETAIL_B2C" | "RETAIL_B2B";

export const TIPOS_STOREFRONT: { value: TipoStorefront; label: string; descripcion: string }[] = [
  {
    value: "RETAIL_B2C",
    label: "Retail (B2C)",
    descripcion: "Catálogo público con carrito y pago inmediato al recoger o en línea.",
  },
  {
    value: "RETAIL_B2B",
    label: "Retail (B2B)",
    descripcion: "Pedidos semanales a crédito para negocios que te compran a ti (cafeterías, restaurantes).",
  },
];

export interface RegisterPayload {
  nombreNegocio: string;
  slug: string;
  nombreDueno: string;
  email: string;
  password: string;
  tipoStorefront: TipoStorefront;
  horarioAtencion?: HorarioSemana;
  ubicacion?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface CurrentUser {
  id: string;
  nombre: string;
  email: string;
  rol: Role;
  tenantId: string;
  tenant: { nombre: string; tipoStorefront: TipoStorefront };
}

export interface Category {
  id: string;
  tenantId: string;
  nombre: string;
  orden: number;
  activa: boolean;
  _count: { products: number };
}

export interface Product {
  id: string;
  tenantId: string;
  categoryId: string;
  nombre: string;
  descripcion: string | null;
  precio: string;
  fotoUrl: string | null;
  disponible: boolean;
}

export interface CreateCategoryPayload {
  nombre: string;
  orden?: number;
  activa?: boolean;
}

export interface UpdateCategoryPayload {
  nombre?: string;
  orden?: number;
  activa?: boolean;
}

export interface CreateProductPayload {
  nombre: string;
  descripcion?: string;
  precio: number;
  categoryId: string;
  fotoUrl?: string;
  disponible?: boolean;
}

export interface UpdateProductPayload {
  nombre?: string;
  descripcion?: string;
  precio?: number;
  categoryId?: string;
  fotoUrl?: string;
  disponible?: boolean;
}

export interface TeamUser {
  id: string;
  nombre: string;
  email: string;
  rol: Role;
  activo: boolean;
  createdAt: string;
}

export interface CreateUserPayload {
  nombre: string;
  email: string;
  rol: Role;
}

export interface UpdateUserPayload {
  rol?: Role;
  activo?: boolean;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export type PromotionTipo = "DESCUENTO_PRODUCTO" | "COMBO";

export interface DescuentoProductoConfig {
  productId: string;
  tipoDescuento: "porcentaje" | "monto_fijo";
  valor: number;
}

export interface ComboConfig {
  productIds: string[];
  precioCombo: number;
}

export interface Promotion {
  id: string;
  tenantId: string;
  tipo: PromotionTipo;
  config: DescuentoProductoConfig | ComboConfig;
  activa: boolean;
}

export interface CreatePromotionPayload {
  tipo: PromotionTipo;
  config: DescuentoProductoConfig | ComboConfig;
  activa?: boolean;
}

export interface UpdatePromotionPayload {
  activa?: boolean;
  config?: DescuentoProductoConfig | ComboConfig;
}

export type TipoSeleccion = "UNICA" | "MULTIPLE";

export interface ModifierOption {
  id: string;
  tenantId: string;
  modifierGroupId: string;
  nombre: string;
  precioAdicional: string;
  activo: boolean;
}

export interface ModifierGroup {
  id: string;
  tenantId: string;
  nombre: string;
  tipoSeleccion: TipoSeleccion;
  obligatorio: boolean;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
  opciones: ModifierOption[];
}

export interface CreateModifierOptionPayload {
  nombre: string;
  precioAdicional?: number;
  activo?: boolean;
}

export interface CreateModifierGroupPayload {
  nombre: string;
  tipoSeleccion: TipoSeleccion;
  obligatorio?: boolean;
  activo?: boolean;
  opciones?: CreateModifierOptionPayload[];
}

export interface UpdateModifierGroupPayload {
  nombre?: string;
  tipoSeleccion?: TipoSeleccion;
  obligatorio?: boolean;
  activo?: boolean;
}

export interface UpdateModifierOptionPayload {
  nombre?: string;
  precioAdicional?: number;
  activo?: boolean;
}

export interface ProductModifierGroupAssignment {
  productId: string;
  modifierGroupId: string;
  orden: number;
  modifierGroup: ModifierGroup;
}

export interface ProductDetail extends Product {
  category: { id: string; nombre: string };
  modifierGroups: ProductModifierGroupAssignment[];
}

export interface PublicTenantInfo {
  nombre: string;
  logoUrl: string | null;
  horarioAtencion: HorarioSemana | null;
  ubicacion: string | null;
  abierto: boolean;
  facturacionModo: FacturacionModo;
  // Whether metodoPago = TARJETA can be offered at checkout — the server
  // re-checks this independently at order creation, this is only a UI hint.
  aceptaTarjeta: boolean;
}

export interface PublicModifierOption {
  id: string;
  nombre: string;
  precioAdicional: string;
}

export interface PublicModifierGroup {
  id: string;
  nombre: string;
  tipoSeleccion: TipoSeleccion;
  obligatorio: boolean;
  opciones: PublicModifierOption[];
}

export interface PublicProduct {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: string;
  fotoUrl: string | null;
  disponible: boolean;
  modifierGroups: PublicModifierGroup[];
}

export interface PublicCategory {
  id: string;
  nombre: string;
  products: PublicProduct[];
}

export interface PublicPromotion {
  id: string;
  tipo: PromotionTipo;
  config: DescuentoProductoConfig | ComboConfig;
}

export interface PublicCatalog {
  categories: PublicCategory[];
  promotions: PublicPromotion[];
}

export type HoraRecogidaTipo = "LO_ANTES_POSIBLE" | "HORA_ESPECIFICA";
export type MetodoPago = "EFECTIVO" | "TRANSFERENCIA" | "TARJETA";
export type MetodoEntrega = "RECOGER" | "DOMICILIO";

export const METODO_PAGO_LABEL: Record<MetodoPago, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
};

export interface PublicPuntoEnvio {
  id: string;
  nombre: string;
  direccion: string;
  pedidoMinimo: string | null;
}

export interface CreatePublicOrderPayload {
  clienteNombre: string;
  clienteTelefono: string;
  // Correo general del cliente — opcional, independiente de facturación
  // (distinto de facturaCorreo más abajo). Ver checkout-modal.tsx, paso
  // "datos".
  clienteCorreo?: string;
  notas?: string;
  horaRecogidaTipo?: HoraRecogidaTipo;
  horaRecogida?: string;
  metodoPago: MetodoPago;
  metodoEntrega?: MetodoEntrega;
  puntoEnvioId?: string;
  // Required (enforced in PublicService, not here) only when metodoEntrega =
  // DOMICILIO. direccionReferencias is always optional.
  direccionCalle?: string;
  direccionNumero?: string;
  direccionColonia?: string;
  direccionReferencias?: string;
  requiereFactura?: boolean;
  facturaRazonSocial?: string;
  facturaRfc?: string;
  facturaRegimenFiscal?: string;
  facturaUsoCfdi?: string;
  facturaCodigoPostal?: string;
  facturaCorreo?: string;
  items: { productId: string; cantidad: number; modifierOptionIds?: string[] }[];
}

export interface PublicOrderItem {
  id: string;
  productId: string | null;
  nombreProducto: string;
  precioUnitario: string;
  cantidad: number;
}

export type EstadoPedido = "PENDIENTE_CONFIRMACION" | "CONFIRMADO_SURTIENDO" | "LISTO_ENTREGA" | "DESPACHADO";
export type EstadoPago = "PENDIENTE" | "PAGADO" | "FALLIDO" | "REEMBOLSADO";

export interface PublicOrder {
  id: string;
  folio: string;
  clienteNombre: string;
  clienteTelefono: string;
  clienteCorreo: string | null;
  notas: string | null;
  horaRecogidaTipo: HoraRecogidaTipo;
  horaRecogida: string | null;
  metodoPago: MetodoPago;
  // Only meaningful for TARJETA — EFECTIVO/TRANSFERENCIA are always PAGADO.
  estadoPago: EstadoPago;
  // Present only for metodoPago = TARJETA, right after creating the order —
  // needed to confirm the payment client-side with Stripe.js. Absent (not
  // just undefined-in-practice, actually never sent) for any other method.
  clientSecret?: string | null;
  // Set only once estadoPago = REEMBOLSADO — see OrdersService.reembolsar.
  stripeRefundId?: string | null;
  metodoEntrega: MetodoEntrega;
  puntoEnvioId: string | null;
  direccionCalle: string | null;
  direccionNumero: string | null;
  direccionColonia: string | null;
  direccionReferencias: string | null;
  requiereFactura: boolean;
  facturaRazonSocial: string | null;
  facturaRfc: string | null;
  facturaRegimenFiscal: string | null;
  facturaUsoCfdi: string | null;
  facturaCodigoPostal: string | null;
  facturaCorreo: string | null;
  estadoPedido: EstadoPedido;
  descuentoTotal: string;
  notasDescuento: string | null;
  total: string;
  items: PublicOrderItem[];
}

export interface Order extends PublicOrder {
  tenantId: string;
  canalOrigen: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrdersFilter {
  estadoPedido?: EstadoPedido;
  desde?: string;
  hasta?: string;
}

export interface HistoricoOrdersFilter {
  estadoPedido?: EstadoPedido;
  metodoPago?: MetodoPago;
  desde?: string;
  hasta?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedOrders {
  data: Order[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface Payment {
  id: string;
  amount: string;
  currency: string;
  status: EstadoPago;
  paymentMethodType: string | null;
  cardBrand: string | null;
  last4: string | null;
  capturedAt: string | null;
  createdAt: string;
  folio: string;
}

export interface PaymentsFilter {
  status?: EstadoPago;
  paymentMethodType?: string;
  desde?: string;
  hasta?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedPayments {
  data: Payment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface OrderSummary {
  pedidosHoy: number;
  ingresosHoy: string;
  ticketPromedioHoy: string;
  promocionesActivas: number;
}

export interface OrdersPorDia {
  fecha: string;
  pedidos: number;
}

export type FacturacionModo = "OBLIGATORIO" | "OPCIONAL" | "DESACTIVADO";

// Rango semanal recurrente en el que el storefront de mayoreo (/mayoreo/[slug])
// acepta pedidos nuevos — ver Tenant.pedidoB2bVentana* / ventanaRecepcionB2b
// en UpdateTenantSettingsPayload. null en TenantSettings significa "sin
// ventana configurada" (el storefront acepta pedidos en cualquier momento).
export interface VentanaRecepcionB2b {
  aperturaDia: DiaSemanaPedidoB2b;
  aperturaHora: string;
  cierreDia: DiaSemanaPedidoB2b;
  cierreHora: string;
}

export interface TenantSettings {
  nombre: string;
  mensajeBienvenida: string;
  horarioAtencion: HorarioSemana | null;
  ubicacion: string | null;
  botApiKey: string;
  facturacionModo: FacturacionModo;
  stripeContactEmail: string | null;
  // Read-only — never sent via UpdateTenantSettingsPayload. Managed through
  // createTenantStripeAccount/fetchTenantStripeStatus instead.
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  ventanaRecepcionB2b: VentanaRecepcionB2b | null;
}

export interface TenantStripeStatus {
  estado: "sin_cuenta" | "con_cuenta";
  stripeAccountId?: string;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
}

export interface UpdateTenantSettingsPayload {
  mensajeBienvenida?: string;
  horarioAtencion?: HorarioSemana;
  ubicacion?: string;
  facturacionModo?: FacturacionModo;
  stripeContactEmail?: string;
  // Objeto para configurar, null para limpiar (vuelve a "sin ventana
  // configurada"), omitido para no tocarla — mismo contrato que
  // UpdateTenantDto.ventanaRecepcionB2b en el backend.
  ventanaRecepcionB2b?: VentanaRecepcionB2b | null;
}

export interface PuntoEnvio {
  id: string;
  tenantId: string;
  nombre: string;
  direccion: string;
  pedidoMinimo: string | null;
  activo: boolean;
}

export interface CreatePuntoEnvioPayload {
  nombre: string;
  direccion: string;
  pedidoMinimo?: number;
  activo?: boolean;
}

export interface UpdatePuntoEnvioPayload {
  nombre?: string;
  direccion?: string;
  pedidoMinimo?: number;
  activo?: boolean;
}

// --- Notificaciones (/dashboard/ajustes/notificaciones) ---

export type NotificacionCanalTipo = "TELEGRAM" | "CORREO";
export type NotificacionEvento =
  | "PEDIDO_RECIBIDO"
  | "PEDIDO_CONFIRMADO"
  | "PEDIDO_EN_CAMINO"
  | "PEDIDO_ENTREGADO"
  | "PAGO_CONFIRMADO";
export type NotificacionAudiencia = "CLIENTE" | "NEGOCIO";

// `config` shape depende de `tipo` — ver comentario en schema.prisma:
//   TELEGRAM -> { chatId: string } (lo captura el webhook de conexión)
//   CORREO   -> { nombreRemitente: string, correoDestino?: string }
export interface NotificacionCanalConfig {
  id: string;
  tenantId: string;
  tipo: NotificacionCanalTipo;
  activo: boolean;
  conectado: boolean;
  config: Record<string, unknown>;
}

export interface NotificacionEventoConfig {
  id: string;
  tenantId: string;
  evento: NotificacionEvento;
  audiencia: NotificacionAudiencia;
  canalConfigId: string;
  activo: boolean;
  canalConfig: NotificacionCanalConfig;
}

export interface CreateNotificacionCanalConfigPayload {
  tipo: NotificacionCanalTipo;
  config: Record<string, unknown>;
  activo?: boolean;
}

export interface UpdateNotificacionCanalConfigPayload {
  config?: Record<string, unknown>;
  activo?: boolean;
}

export interface CreateNotificacionEventoConfigPayload {
  evento: NotificacionEvento;
  audiencia: NotificacionAudiencia;
  canalConfigId: string;
  activo?: boolean;
}

export interface UpdateNotificacionEventoConfigPayload {
  activo?: boolean;
  canalConfigId?: string;
}

// --- Códigos de descuento B2B (/dashboard/ajustes/codigos-descuento) ---
// usosActuales es derivado por el backend (conteo de PedidoB2b vinculados,
// incluyendo cancelados) en cada GET — nunca se manda al crear/editar, solo
// se muestra. usosMaximos/fechaLimite null = ilimitado/sin fecha límite.
export interface CodigoDescuentoB2b {
  id: string;
  tenantId: string;
  codigo: string;
  descuentoPorcentaje: string;
  activo: boolean;
  usosMaximos: number | null;
  fechaLimite: string | null;
  usosActuales: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCodigoDescuentoB2bPayload {
  codigo: string;
  descuentoPorcentaje: number;
  activo?: boolean;
  usosMaximos?: number | null;
  fechaLimite?: string | null;
}

export interface UpdateCodigoDescuentoB2bPayload {
  codigo?: string;
  descuentoPorcentaje?: number;
  activo?: boolean;
  usosMaximos?: number | null;
  fechaLimite?: string | null;
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = body?.message ?? "Ocurrió un error inesperado";
    throw new ApiError(Array.isArray(message) ? message[0] : message, res.status);
  }

  return body as T;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function checkSlugAvailability(slug: string) {
  return request<{ slug: string; available: boolean }>(
    `/auth/slug-availability?slug=${encodeURIComponent(slug)}`,
  );
}

export function register(payload: RegisterPayload) {
  return request<Session>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload: LoginPayload) {
  return request<Session>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchCurrentUser(token: string) {
  return request<CurrentUser>("/auth/me", { headers: authHeaders(token) });
}

export function fetchCategories(token: string) {
  return request<Category[]>("/categories", { headers: authHeaders(token) });
}

export function createCategory(token: string, payload: CreateCategoryPayload) {
  return request<Category>("/categories", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function updateCategory(token: string, id: string, payload: UpdateCategoryPayload) {
  return request<Category>(`/categories/${id}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function deleteCategory(token: string, id: string) {
  return request<void>(`/categories/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export function fetchProducts(token: string, categoryId?: string) {
  const query = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : "";
  return request<Product[]>(`/products${query}`, { headers: authHeaders(token) });
}

export function fetchProduct(token: string, id: string) {
  return request<ProductDetail>(`/products/${id}`, { headers: authHeaders(token) });
}

export function createProduct(token: string, payload: CreateProductPayload) {
  return request<Product>("/products", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function updateProduct(token: string, id: string, payload: UpdateProductPayload) {
  return request<Product>(`/products/${id}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function deleteProduct(token: string, id: string) {
  return request<void>(`/products/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export function fetchUsers(token: string) {
  return request<TeamUser[]>("/users", { headers: authHeaders(token) });
}

export function createUser(token: string, payload: CreateUserPayload) {
  return request<TeamUser & { temporaryPassword: string }>("/users", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function updateUser(token: string, id: string, payload: UpdateUserPayload) {
  return request<TeamUser>(`/users/${id}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function changePassword(token: string, payload: ChangePasswordPayload) {
  return request<{ success: boolean }>("/auth/change-password", {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function fetchPromotions(token: string) {
  return request<Promotion[]>("/promotions", { headers: authHeaders(token) });
}

export function createPromotion(token: string, payload: CreatePromotionPayload) {
  return request<Promotion>("/promotions", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function updatePromotion(token: string, id: string, payload: UpdatePromotionPayload) {
  return request<Promotion>(`/promotions/${id}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function deletePromotion(token: string, id: string) {
  return request<void>(`/promotions/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export function fetchModifierGroups(token: string) {
  return request<ModifierGroup[]>("/modifier-groups", { headers: authHeaders(token) });
}

export function createModifierGroup(token: string, payload: CreateModifierGroupPayload) {
  return request<ModifierGroup>("/modifier-groups", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function updateModifierGroup(token: string, id: string, payload: UpdateModifierGroupPayload) {
  return request<ModifierGroup>(`/modifier-groups/${id}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function deleteModifierGroup(token: string, id: string) {
  return request<void>(`/modifier-groups/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export function createModifierOption(token: string, modifierGroupId: string, payload: CreateModifierOptionPayload) {
  return request<ModifierOption>(`/modifier-groups/${modifierGroupId}/opciones`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function updateModifierOption(token: string, optionId: string, payload: UpdateModifierOptionPayload) {
  return request<ModifierOption>(`/modifier-groups/opciones/${optionId}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function deleteModifierOption(token: string, optionId: string) {
  return request<void>(`/modifier-groups/opciones/${optionId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export function assignModifierGroupToProduct(token: string, modifierGroupId: string, productId: string, orden?: number) {
  return request<ProductModifierGroupAssignment>(`/modifier-groups/${modifierGroupId}/products/${productId}`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(orden !== undefined ? { orden } : {}),
  });
}

export function unassignModifierGroupFromProduct(token: string, modifierGroupId: string, productId: string) {
  return request<void>(`/modifier-groups/${modifierGroupId}/products/${productId}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export function fetchPublicTenant(slug: string) {
  return request<PublicTenantInfo>(`/public/tenants/${encodeURIComponent(slug)}`);
}

export function fetchPublicCatalog(slug: string) {
  return request<PublicCatalog>(`/public/tenants/${encodeURIComponent(slug)}/catalog`);
}

export function fetchPublicPuntosEnvio(slug: string) {
  return request<PublicPuntoEnvio[]>(`/public/tenants/${encodeURIComponent(slug)}/puntos-envio`);
}

export function createPublicOrder(slug: string, payload: CreatePublicOrderPayload) {
  return request<PublicOrder>(`/public/tenants/${encodeURIComponent(slug)}/orders`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchOrders(token: string, filter?: OrdersFilter) {
  const params = new URLSearchParams();
  if (filter?.estadoPedido) params.set("estadoPedido", filter.estadoPedido);
  if (filter?.desde) params.set("desde", filter.desde);
  if (filter?.hasta) params.set("hasta", filter.hasta);
  const query = params.toString();
  return request<Order[]>(`/orders${query ? `?${query}` : ""}`, { headers: authHeaders(token) });
}

export function fetchOrdersHistorico(token: string, filter?: HistoricoOrdersFilter) {
  const params = new URLSearchParams();
  if (filter?.estadoPedido) params.set("estadoPedido", filter.estadoPedido);
  if (filter?.metodoPago) params.set("metodoPago", filter.metodoPago);
  if (filter?.desde) params.set("desde", filter.desde);
  if (filter?.hasta) params.set("hasta", filter.hasta);
  if (filter?.page) params.set("page", String(filter.page));
  if (filter?.limit) params.set("limit", String(filter.limit));
  const query = params.toString();
  return request<PaginatedOrders>(`/orders/historico${query ? `?${query}` : ""}`, { headers: authHeaders(token) });
}

export function fetchPayments(token: string, filter?: PaymentsFilter) {
  const params = new URLSearchParams();
  if (filter?.status) params.set("status", filter.status);
  if (filter?.paymentMethodType) params.set("paymentMethodType", filter.paymentMethodType);
  if (filter?.desde) params.set("desde", filter.desde);
  if (filter?.hasta) params.set("hasta", filter.hasta);
  if (filter?.page) params.set("page", String(filter.page));
  if (filter?.limit) params.set("limit", String(filter.limit));
  const query = params.toString();
  return request<PaginatedPayments>(`/payments${query ? `?${query}` : ""}`, { headers: authHeaders(token) });
}

// Bypasses request() on purpose — same reason as exportOrdersHistoricoCsv:
// that wrapper always calls res.json(), but this endpoint returns a CSV
// file, not JSON.
export async function exportPaymentsCsv(
  token: string,
  filter?: Omit<PaymentsFilter, "page" | "limit">,
): Promise<Blob> {
  const params = new URLSearchParams();
  if (filter?.status) params.set("status", filter.status);
  if (filter?.paymentMethodType) params.set("paymentMethodType", filter.paymentMethodType);
  if (filter?.desde) params.set("desde", filter.desde);
  if (filter?.hasta) params.set("hasta", filter.hasta);
  const query = params.toString();

  const res = await fetch(`${API_URL}/payments/export${query ? `?${query}` : ""}`, {
    headers: authHeaders(token),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.message ?? "No se pudo exportar los pagos";
    throw new ApiError(Array.isArray(message) ? message[0] : message, res.status);
  }

  return res.blob();
}

// Bypasses request() on purpose — that wrapper always calls res.json(), but
// this endpoint returns a CSV file, not JSON. Reuses API_URL/authHeaders
// directly instead.
export async function exportOrdersHistoricoCsv(
  token: string,
  filter?: Omit<HistoricoOrdersFilter, "page" | "limit">,
): Promise<Blob> {
  const params = new URLSearchParams();
  if (filter?.estadoPedido) params.set("estadoPedido", filter.estadoPedido);
  if (filter?.metodoPago) params.set("metodoPago", filter.metodoPago);
  if (filter?.desde) params.set("desde", filter.desde);
  if (filter?.hasta) params.set("hasta", filter.hasta);
  const query = params.toString();

  const res = await fetch(`${API_URL}/orders/historico/export${query ? `?${query}` : ""}`, {
    headers: authHeaders(token),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.message ?? "No se pudo exportar el histórico";
    throw new ApiError(Array.isArray(message) ? message[0] : message, res.status);
  }

  return res.blob();
}

export function fetchOrdersSummary(token: string, range: { desde: string; hasta: string }) {
  const params = new URLSearchParams({ desde: range.desde, hasta: range.hasta });
  return request<OrderSummary>(`/orders/summary?${params.toString()}`, { headers: authHeaders(token) });
}

export function fetchOrdersSummaryDaily(token: string, range: { desde: string; hasta: string }) {
  const params = new URLSearchParams({ desde: range.desde, hasta: range.hasta });
  return request<OrdersPorDia[]>(`/orders/summary/daily?${params.toString()}`, { headers: authHeaders(token) });
}

export function fetchOrder(token: string, id: string) {
  return request<Order>(`/orders/${id}`, { headers: authHeaders(token) });
}

export function avanzarOrder(token: string, id: string) {
  return request<Order>(`/orders/${id}/avanzar`, {
    method: "PATCH",
    headers: authHeaders(token),
  });
}

export function reembolsarOrder(token: string, id: string) {
  return request<Order>(`/orders/${id}/reembolsar`, {
    method: "POST",
    headers: authHeaders(token),
  });
}

export function fetchTenantSettings(token: string) {
  return request<TenantSettings>("/tenant/me", { headers: authHeaders(token) });
}

export function updateTenantSettings(token: string, payload: UpdateTenantSettingsPayload) {
  return request<TenantSettings>("/tenant/me", {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function regenerateBotApiKey(token: string) {
  return request<TenantSettings>("/tenant/me/regenerate-bot-key", {
    method: "POST",
    headers: authHeaders(token),
  });
}

export function createTenantStripeAccount(token: string) {
  return request<{ url: string }>("/tenant/me/stripe-account", {
    method: "POST",
    headers: authHeaders(token),
  });
}

export function fetchTenantStripeStatus(token: string) {
  return request<TenantStripeStatus>("/tenant/me/stripe-status", { headers: authHeaders(token) });
}

export function fetchPuntosEnvio(token: string) {
  return request<PuntoEnvio[]>("/puntos-envio", { headers: authHeaders(token) });
}

export function createPuntoEnvio(token: string, payload: CreatePuntoEnvioPayload) {
  return request<PuntoEnvio>("/puntos-envio", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function updatePuntoEnvio(token: string, id: string, payload: UpdatePuntoEnvioPayload) {
  return request<PuntoEnvio>(`/puntos-envio/${id}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function deletePuntoEnvio(token: string, id: string) {
  return request<void>(`/puntos-envio/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export function fetchNotificacionCanales(token: string) {
  return request<NotificacionCanalConfig[]>("/notificaciones/canales", { headers: authHeaders(token) });
}

export function createNotificacionCanal(token: string, payload: CreateNotificacionCanalConfigPayload) {
  return request<NotificacionCanalConfig>("/notificaciones/canales", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function updateNotificacionCanal(token: string, id: string, payload: UpdateNotificacionCanalConfigPayload) {
  return request<NotificacionCanalConfig>(`/notificaciones/canales/${id}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function deleteNotificacionCanal(token: string, id: string) {
  return request<void>(`/notificaciones/canales/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export function fetchNotificacionEventos(token: string) {
  return request<NotificacionEventoConfig[]>("/notificaciones/eventos", { headers: authHeaders(token) });
}

export function createNotificacionEvento(token: string, payload: CreateNotificacionEventoConfigPayload) {
  return request<NotificacionEventoConfig>("/notificaciones/eventos", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function updateNotificacionEvento(token: string, id: string, payload: UpdateNotificacionEventoConfigPayload) {
  return request<NotificacionEventoConfig>(`/notificaciones/eventos/${id}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function deleteNotificacionEvento(token: string, id: string) {
  return request<void>(`/notificaciones/eventos/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export function conectarTelegram(token: string) {
  return request<{ url: string }>("/notificaciones/telegram/conectar", {
    method: "POST",
    headers: authHeaders(token),
  });
}

export function fetchCodigosDescuentoB2b(token: string) {
  return request<CodigoDescuentoB2b[]>("/codigos-descuento-b2b", { headers: authHeaders(token) });
}

export function createCodigoDescuentoB2b(token: string, payload: CreateCodigoDescuentoB2bPayload) {
  return request<CodigoDescuentoB2b>("/codigos-descuento-b2b", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function updateCodigoDescuentoB2b(token: string, id: string, payload: UpdateCodigoDescuentoB2bPayload) {
  return request<CodigoDescuentoB2b>(`/codigos-descuento-b2b/${id}`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });
}

export function deleteCodigoDescuentoB2b(token: string, id: string) {
  return request<void>(`/codigos-descuento-b2b/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

// --- Storefront público de pedidos B2B (/mayoreo/[slug]) ---
// Deliberadamente separado de los tipos Public*/PedidoB2b* de arriba, aunque
// el nombre "Dia" choque en concepto con DiaSemana (horario) — ese tipo es
// para Tenant.horarioAtencion (minúsculas), este es el enum de Prisma
// DiaSemana del pedido B2B (mayúsculas), así que se nombra distinto para no
// confundir ambos.

export type DiaSemanaPedidoB2b = "LUNES" | "MARTES" | "MIERCOLES" | "JUEVES" | "VIERNES" | "SABADO" | "DOMINGO";

export const DIAS_SEMANA_PEDIDO_B2B: { value: DiaSemanaPedidoB2b; label: string }[] = [
  { value: "LUNES", label: "Lunes" },
  { value: "MARTES", label: "Martes" },
  { value: "MIERCOLES", label: "Miércoles" },
  { value: "JUEVES", label: "Jueves" },
  { value: "VIERNES", label: "Viernes" },
  { value: "SABADO", label: "Sábado" },
  { value: "DOMINGO", label: "Domingo" },
];

export type PedidoB2bModoCobro = "AL_INICIO" | "AL_FINAL";
export type PedidoB2bEstado = "PENDIENTE_CONFIRMACION" | "CONFIRMADO_SURTIENDO" | "DESPACHADO";
export type PedidoB2bEstadoPago = "PENDIENTE" | "PAGADO";

// Semana calendario (lunes-domingo) a la que aplicará el pedido en curso —
// calculada por el backend en timezone México (siempre la próxima semana
// completa, sin importar qué día de la ventana sea hoy). Fechas "YYYY-MM-DD"
// — ver lib/pedido-b2b-fechas.ts para formatearlas sin desfase de timezone.
export interface PedidoB2bSemanaDestino {
  inicio: string;
  fin: string;
}

export interface PublicPedidoB2bTenantInfo {
  nombre: string;
  logoUrl: string | null;
  pedidoB2bModoCobro: PedidoB2bModoCobro;
  pedidoB2bMinimoPiezas: number;
  // A diferencia de PublicTenantInfo.abierto (B2C, horario de atención),
  // este refleja la ventana de recepción de pedidos del módulo B2B — ver
  // Tenant.pedidoB2bVentana* / common/ventana-recepcion-b2b.ts en el backend.
  // El storefront lo usa para bloquear el catálogo/checkout completos
  // mientras la ventana está cerrada; el backend vuelve a revisarlo
  // server-side en createPedido.
  abierto: boolean;
  // Mismo texto que el 409 de createPedido cuando abierto es false —
  // null cuando abierto es true. Ver pantalla de "ventana cerrada" en page.tsx.
  ventanaCerradaMensaje: string | null;
  // Mismo Tenant.facturacionModo que ya usa /tienda — controla si el
  // checkbox "Quiero factura" del resumen se muestra/exige.
  facturacionModo: FacturacionModo;
  semanaDestino: PedidoB2bSemanaDestino;
}

export interface PublicPedidoB2bProduct {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: string;
  fotoUrl: string | null;
  disponible: boolean;
}

export interface PublicPedidoB2bCategory {
  id: string;
  nombre: string;
  products: PublicPedidoB2bProduct[];
}

export interface PublicPedidoB2bCatalog {
  categories: PublicPedidoB2bCategory[];
}

export interface PedidoB2bItemDiaInput {
  dia: DiaSemanaPedidoB2b;
  cantidad: number;
}

export interface PedidoB2bItemInput {
  productId: string;
  distribucion: PedidoB2bItemDiaInput[];
}

export interface CreatePublicPedidoB2bPayload {
  negocioNombre: string;
  contactoNombre: string;
  contactoTelefono: string;
  contactoCorreo: string;
  semanaInicio: string;
  codigoDescuento?: string;
  // Mismos 6 campos + requiereFactura que CreatePublicOrderPayload (B2C) —
  // solo se mandan cuando aplica según facturacionModo, ver pedido-flow.tsx.
  requiereFactura?: boolean;
  facturaRazonSocial?: string;
  facturaRfc?: string;
  facturaRegimenFiscal?: string;
  facturaUsoCfdi?: string;
  facturaCodigoPostal?: string;
  facturaCorreo?: string;
  items: PedidoB2bItemInput[];
}

export interface PublicPedidoB2bItem {
  id: string;
  productId: string | null;
  nombreProducto: string;
  precioUnitario: string;
  cantidadTotal: number;
  distribucion: { id: string; dia: DiaSemanaPedidoB2b; cantidad: number }[];
}

export interface PublicPedidoB2b {
  id: string;
  folio: string;
  negocioNombre: string;
  contactoNombre: string;
  contactoTelefono: string;
  contactoCorreo: string;
  semanaInicio: string;
  modoCobro: PedidoB2bModoCobro;
  estado: PedidoB2bEstado;
  estadoPago: PedidoB2bEstadoPago;
  totalPiezas: number;
  codigoDescuentoTexto: string | null;
  descuentoPorcentajeAplicado: string | null;
  subtotal: string;
  descuentoTotal: string;
  total: string;
  requiereFactura: boolean;
  facturaRazonSocial: string | null;
  facturaRfc: string | null;
  facturaRegimenFiscal: string | null;
  facturaUsoCfdi: string | null;
  facturaCodigoPostal: string | null;
  facturaCorreo: string | null;
  items: PublicPedidoB2bItem[];
}

export function fetchPublicPedidoB2bTenant(slug: string) {
  return request<PublicPedidoB2bTenantInfo>(`/public/pedidos-b2b/tenants/${encodeURIComponent(slug)}`);
}

export function fetchPublicPedidoB2bCatalog(slug: string) {
  return request<PublicPedidoB2bCatalog>(`/public/pedidos-b2b/tenants/${encodeURIComponent(slug)}/catalog`);
}

export function previewPedidoB2bCodigoDescuento(slug: string, codigo: string) {
  return request<{ descuentoPorcentaje: number }>(
    `/public/pedidos-b2b/tenants/${encodeURIComponent(slug)}/codigos-descuento/${encodeURIComponent(codigo)}`,
  );
}

export function createPublicPedidoB2b(slug: string, payload: CreatePublicPedidoB2bPayload) {
  return request<PublicPedidoB2b>(`/public/pedidos-b2b/tenants/${encodeURIComponent(slug)}/pedidos`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// --- Pedidos B2B — panel autenticado (/dashboard/pedidos-b2b) ---

// Forma reportable (listado/export) — ver PedidosB2bService.REPORTABLE_SELECT
// en el backend. No trae items/distribución, solo lo necesario para la
// tarjeta de la lista.
export interface PedidoB2bReportable {
  id: string;
  folio: string;
  negocioNombre: string;
  contactoNombre: string;
  semanaInicio: string;
  estado: PedidoB2bEstado;
  estadoPago: PedidoB2bEstadoPago;
  modoCobro: PedidoB2bModoCobro;
  cancelado: boolean;
  totalPiezas: number;
  total: string;
  createdAt: string;
}

export interface PaginatedPedidosB2b {
  data: PedidoB2bReportable[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Detalle completo (GET /pedidos-b2b/:id) — mismos campos que PublicPedidoB2b
// más los que solo tienen sentido del lado autenticado (cancelado,
// minimoPiezasAplicado, etc.).
export interface PedidoB2bDetalle extends PublicPedidoB2b {
  cancelado: boolean;
  canceladoAt: string | null;
  minimoPiezasAplicado: number;
}

export interface ListPedidosB2bFilter {
  estado?: PedidoB2bEstado;
  cancelado?: boolean;
  desde?: string;
  hasta?: string;
  // Coincidencia parcial, case-insensitive (ver ListPedidosB2bQueryDto en el
  // backend) — usado por "Históricos", que pagina de verdad y por lo tanto
  // necesita resolver este filtro en el servidor (a diferencia de "Pedidos
  // activos", que trae todo sin paginar y filtra en el cliente).
  negocioNombre?: string;
  page?: number;
  limit?: number;
}

export function fetchPedidosB2b(token: string, filter?: ListPedidosB2bFilter) {
  const params = new URLSearchParams();
  if (filter?.estado) params.set("estado", filter.estado);
  if (filter?.cancelado !== undefined) params.set("cancelado", String(filter.cancelado));
  if (filter?.desde) params.set("desde", filter.desde);
  if (filter?.hasta) params.set("hasta", filter.hasta);
  if (filter?.negocioNombre) params.set("negocioNombre", filter.negocioNombre);
  if (filter?.page) params.set("page", String(filter.page));
  if (filter?.limit) params.set("limit", String(filter.limit));
  const query = params.toString();
  return request<PaginatedPedidosB2b>(`/pedidos-b2b${query ? `?${query}` : ""}`, { headers: authHeaders(token) });
}

export function fetchPedidoB2b(token: string, id: string) {
  return request<PedidoB2bDetalle>(`/pedidos-b2b/${id}`, { headers: authHeaders(token) });
}

// Agregado para /dashboard (Inicio B2B) — ver PedidosB2bService.resumen en
// el backend. "Semana en curso" es la que ya se está surtiendo, distinta de
// "próxima semana" (la que calcularSemanaDestino calcula para pedidos
// entrando ahora mismo por la ventana de recepción del storefront).
export interface PedidoB2bEntregaResumen {
  folio: string;
  negocioNombre: string;
  cantidad: number;
}

export interface PedidoB2bPendienteResumen {
  id: string;
  folio: string;
  negocioNombre: string;
  diasPendiente: number;
}

export interface PedidoB2bRankingProducto {
  nombreProducto: string;
  cantidadTotal: number;
}

export interface PedidoB2bResumen {
  semanaEnCurso: {
    inicio: string;
    fin: string;
    pendientesConfirmacion: number;
    confirmadosSurtiendo: number;
    totalPiezas: number;
    entregasHoy: PedidoB2bEntregaResumen[];
    entregasManana: PedidoB2bEntregaResumen[];
    pendientesMasAntiguos: PedidoB2bPendienteResumen[];
  };
  proximaSemana: {
    inicio: string;
    fin: string;
    totalPedidos: number;
    totalPiezas: number;
  };
  rankingProductos: PedidoB2bRankingProducto[];
}

export function fetchPedidosB2bResumen(token: string) {
  return request<PedidoB2bResumen>("/pedidos-b2b/resumen", { headers: authHeaders(token) });
}

export function updatePedidoB2bItems(token: string, id: string, items: PedidoB2bItemInput[]) {
  return request<PedidoB2bDetalle>(`/pedidos-b2b/${id}/items`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ items }),
  });
}

export function avanzarPedidoB2b(token: string, id: string) {
  return request<PedidoB2bDetalle>(`/pedidos-b2b/${id}/avanzar`, {
    method: "PATCH",
    headers: authHeaders(token),
  });
}

export function marcarPagadoPedidoB2b(token: string, id: string) {
  return request<PedidoB2bDetalle>(`/pedidos-b2b/${id}/marcar-pagado`, {
    method: "PATCH",
    headers: authHeaders(token),
  });
}

export function cancelarPedidoB2b(token: string, id: string) {
  return request<PedidoB2bDetalle>(`/pedidos-b2b/${id}/cancelar`, {
    method: "PATCH",
    headers: authHeaders(token),
  });
}

export interface ExportPedidosB2bFilter {
  estado?: PedidoB2bEstado;
  // Multi-valor — solo lo usa "Pedidos activos" para exportar
  // "Pendiente + Confirmado" en una sola llamada (ver
  // ExportPedidosB2bQueryDto en el backend). Si ambos llegan, el backend
  // prioriza `estados`.
  estados?: PedidoB2bEstado[];
  // Cancelación es un flag ortogonal a `estado` (no lo cambia, ver
  // schema.prisma) — un pedido cancelado conserva el estado que tenía al
  // cancelarse, así que sin `cancelado` explícito también se colaría en un
  // export que solo filtra por estado.
  cancelado?: boolean;
  desde?: string;
  hasta?: string;
  negocioNombre?: string;
}

// Bypasses request() on purpose, igual que exportOrdersHistoricoCsv — este
// endpoint regresa un CSV, no JSON.
export async function exportPedidosB2bCsv(token: string, filter?: ExportPedidosB2bFilter): Promise<Blob> {
  const params = new URLSearchParams();
  if (filter?.estados && filter.estados.length > 0) params.set("estados", filter.estados.join(","));
  else if (filter?.estado) params.set("estado", filter.estado);
  if (filter?.cancelado !== undefined) params.set("cancelado", String(filter.cancelado));
  if (filter?.desde) params.set("desde", filter.desde);
  if (filter?.hasta) params.set("hasta", filter.hasta);
  if (filter?.negocioNombre) params.set("negocioNombre", filter.negocioNombre);
  const query = params.toString();

  const res = await fetch(`${API_URL}/pedidos-b2b/export${query ? `?${query}` : ""}`, {
    headers: authHeaders(token),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.message ?? "No se pudo exportar los pedidos";
    throw new ApiError(Array.isArray(message) ? message[0] : message, res.status);
  }

  return res.blob();
}

// --- Pedidos B2B — "Pedidos del día" (/dashboard/pedidos-b2b/dia) ---

export interface PedidoB2bEntregaDiaItem {
  productId: string | null;
  nombreProducto: string;
  precioUnitario: string;
  cantidad: number;
}

// Un pedido activo con sus items ya recortados a un solo día — nunca el
// pedido completo. Ver PedidosB2bService.findEntregasDia en el backend.
export interface PedidoB2bEntregaDia {
  id: string;
  folio: string;
  negocioNombre: string;
  contactoNombre: string;
  contactoTelefono: string;
  estado: PedidoB2bEstado;
  items: PedidoB2bEntregaDiaItem[];
}

// `fecha` es "YYYY-MM-DD" — el backend resuelve a qué semana/DiaSemana
// pertenece (PedidoB2bItemDia no guarda una fecha real, ver
// resolverSemanaYDia en pedidos-b2b-logica.ts).
export function fetchPedidosB2bDia(token: string, fecha: string) {
  return request<PedidoB2bEntregaDia[]>(`/pedidos-b2b/dia/${encodeURIComponent(fecha)}`, {
    headers: authHeaders(token),
  });
}

// Bypasses request() on purpose, mismo motivo que exportPedidosB2bCsv — CSV,
// no JSON.
export async function exportPedidosB2bDiaCsv(token: string, fecha: string): Promise<Blob> {
  const res = await fetch(`${API_URL}/pedidos-b2b/dia/${encodeURIComponent(fecha)}/export`, {
    headers: authHeaders(token),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.message ?? "No se pudo exportar las entregas del día";
    throw new ApiError(Array.isArray(message) ? message[0] : message, res.status);
  }

  return res.blob();
}

export { ApiError };
