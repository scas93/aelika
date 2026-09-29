import request from 'supertest';
import { tokenFor } from './auth';
import { BaseSeed } from './db';
import { Harness } from './harness';
import { auth, AHORA } from './helpers';

// Reloj fijo: miércoles 2026-09-30 10:00 CDMX. Semanas (todas LUNES):
export const SEMANA_PASADA = '2026-09-21';
export const SEMANA_ACTUAL = '2026-09-28';
export const SEMANA_PROXIMA = '2026-10-05'; // semana destino desde el miércoles fijo
export const SEMANA_SIGUIENTE = '2026-10-12';
export { AHORA };

export type DiaSemana = 'LUNES' | 'MARTES' | 'MIERCOLES' | 'JUEVES' | 'VIERNES' | 'SABADO' | 'DOMINGO';
export type ItemInput = { productId: string; distribucion: { dia: DiaSemana; cantidad: number }[] };

/**
 * Body B2B válido por defecto: Café americano (LUNES 6 + MIERCOLES 6 = 12 pzas × $45 = $540)
 * y Concha (VIERNES 4 pzas × $30.50 = $122): 16 piezas, subtotal $662.
 */
export function bodyB2b(base: BaseSeed, extra: Record<string, unknown> = {}) {
  return {
    negocioNombre: 'Cafetería La Esquina',
    contactoNombre: 'Luis Compras',
    contactoTelefono: '+52 55 3333 4444',
    contactoCorreo: 'compras@laesquina.test',
    semanaInicio: SEMANA_PROXIMA,
    items: [
      {
        productId: base.productoA.id,
        distribucion: [
          { dia: 'LUNES', cantidad: 6 },
          { dia: 'MIERCOLES', cantidad: 6 },
        ],
      },
      { productId: base.productoB.id, distribucion: [{ dia: 'VIERNES', cantidad: 4 }] },
    ] as ItemInput[],
    ...extra,
  };
}

export const postPublicoB2b = (h: Harness, slug: string, body: Record<string, unknown>) =>
  request(h.app.getHttpServer()).post(`/public/pedidos-b2b/tenants/${slug}/pedidos`).send(body);

export function apiRol(h: Harness, base: BaseSeed, rol: 'DUENO' | 'GERENTE' | 'OPERADOR') {
  const user = rol === 'OPERADOR' ? base.operador : base.dueno;
  return auth(h, tokenFor(h.jwt, user, base.tenant.id, rol));
}

/** Crea un pedido B2B por el flujo admin (POST /pedidos-b2b) y devuelve el body. */
export async function crearAdminB2b(h: Harness, base: BaseSeed, extra: Record<string, unknown> = {}) {
  const res = await apiRol(h, base, 'DUENO').post('/pedidos-b2b', bodyB2b(base, extra));
  if (res.status !== 201) throw new Error(`crearAdminB2b: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** Crea un pedido B2B por el flujo público y devuelve el body. */
export async function crearPublicoB2b(h: Harness, base: BaseSeed, extra: Record<string, unknown> = {}) {
  const res = await postPublicoB2b(h, base.tenant.slug, bodyB2b(base, extra));
  if (res.status !== 201) throw new Error(`crearPublicoB2b: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

// ---------------------------------------------------------------------------
// Plantillas de respuesta (ya normalizadas). El pedido B2B se serializa con
// items + distribucion; `codigoDescuento` solo en findOne.
// ---------------------------------------------------------------------------

export function diaEsperado(dia: DiaSemana, cantidad: number, idx = 0) {
  return { id: '<uuid>', tenantId: '<tenant>', pedidoB2bItemId: `<item${idx}>`, dia, cantidad };
}

/** `idx`: posición del item en el pedido (el id del item se etiqueta como <item0>, <item1>...). */
export function itemB2bEsperado(overrides: Record<string, unknown> = {}, idx = 0) {
  return {
    id: `<item${idx}>`,
    tenantId: '<tenant>',
    pedidoB2bId: '<pedido>',
    productId: '<productoA>',
    nombreProducto: 'Café americano',
    precioUnitario: '45',
    cantidadTotal: 12,
    distribucion: [diaEsperado('LUNES', 6, idx), diaEsperado('MIERCOLES', 6, idx)],
    ...overrides,
  };
}

/** Pedido B2B por defecto de bodyB2b (AL_FINAL, sin factura ni código, 16 piezas, $662). */
export function pedidoB2bEsperado(overrides: Record<string, unknown> = {}) {
  return {
    id: '<pedido>',
    tenantId: '<tenant>',
    folio: '1',
    negocioNombre: 'Cafetería La Esquina',
    contactoNombre: 'Luis Compras',
    contactoTelefono: '+52 55 3333 4444',
    contactoCorreo: 'compras@laesquina.test',
    clienteId: '<cliente>',
    semanaInicio: '<iso>',
    modoCobro: 'AL_FINAL',
    estado: 'PENDIENTE_CONFIRMACION',
    estadoPago: 'PENDIENTE',
    cancelado: false,
    canceladoAt: null,
    minimoPiezasAplicado: 10,
    totalPiezas: 16,
    codigoDescuentoId: null,
    codigoDescuentoTexto: null,
    descuentoPorcentajeAplicado: null,
    subtotal: '662',
    descuentoTotal: '0',
    total: '662',
    requiereFactura: false,
    facturaRazonSocial: null,
    facturaRfc: null,
    facturaRegimenFiscal: null,
    facturaUsoCfdi: null,
    facturaCodigoPostal: null,
    facturaCorreo: null,
    createdAt: '<iso>',
    updatedAt: '<iso>',
    items: [
      itemB2bEsperado(),
      itemB2bEsperado(
        {
          productId: '<productoB>',
          nombreProducto: 'Concha',
          precioUnitario: '30.5',
          cantidadTotal: 4,
          distribucion: [diaEsperado('VIERNES', 4, 1)],
        },
        1,
      ),
    ],
    ...overrides,
  };
}

/** Etiquetas para un pedido B2B: pedido, cliente, productos y (opcional) código. */
export function etiquetasB2b(
  base: BaseSeed,
  pedido?: { id: string; clienteId: string; items?: { id: string; distribucion?: unknown[] }[] },
  extra: Record<string, string> = {},
): Record<string, string> {
  const et: Record<string, string> = {
    [base.tenant.id]: 'tenant',
    [base.productoA.id]: 'productoA',
    [base.productoB.id]: 'productoB',
    ...extra,
  };
  if (pedido) {
    et[pedido.id] = 'pedido';
    et[pedido.clienteId] = 'cliente';
    pedido.items?.forEach((item, i) => (et[item.id] = `item${i}`));
  }
  return et;
}
