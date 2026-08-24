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

export interface RegisterPayload {
  nombreNegocio: string;
  slug: string;
  nombreDueno: string;
  email: string;
  password: string;
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
  tenant: { nombre: string };
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
export type EstadoPago = "PENDIENTE" | "PAGADO" | "FALLIDO";

export interface PublicOrder {
  id: string;
  folio: string;
  clienteNombre: string;
  clienteTelefono: string;
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

export { ApiError };
