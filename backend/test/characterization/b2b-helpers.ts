import request from 'supertest';
import { tokenFor } from './auth';
import { BaseSeed } from './db';
import { Harness } from './harness';
import { auth, AHORA } from './helpers';
import { crearClienteB2b, slugificar } from '../../src/clientes/cliente-b2b';

// Reloj fijo: miércoles 2026-09-30 10:00 CDMX. Semanas (todas LUNES):
export const SEMANA_PASADA = '2026-09-21';
export const SEMANA_ACTUAL = '2026-09-28';
export const SEMANA_PROXIMA = '2026-10-05'; // semana destino desde el miércoles fijo
export const SEMANA_SIGUIENTE = '2026-10-12';
export { AHORA };

export type DiaSemana =
  | 'LUNES'
  | 'MARTES'
  | 'MIERCOLES'
  | 'JUEVES'
  | 'VIERNES'
  | 'SABADO'
  | 'DOMINGO';
export type ItemInput = {
  productId: string;
  distribucion: { dia: DiaSemana; cantidad: number }[];
};

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
      {
        productId: base.productoB.id,
        distribucion: [{ dia: 'VIERNES', cantidad: 4 }],
      },
    ] as ItemInput[],
    ...extra,
  };
}

export const postPublicoB2b = (
  h: Harness,
  slug: string,
  body: Record<string, unknown>,
) =>
  request(h.app.getHttpServer())
    .post(`/public/pedidos-b2b/tenants/${slug}/pedidos`)
    .send(body);

export function apiRol(
  h: Harness,
  base: BaseSeed,
  rol: 'DUENO' | 'GERENTE' | 'OPERADOR',
) {
  const user = rol === 'OPERADOR' ? base.operador : base.dueno;
  return auth(h, tokenFor(h.jwt, user, base.tenant.id, rol));
}

/**
 * Cierra (una por una, como en el panel) las entregas pendientes de un pedido B2B ya confirmado. Reemplaza al antiguo
 * "despachar" (segundo `avanzar`) como paso de preparación: con todas cerradas el pedido queda COMPLETADO.
 * Devuelve el body de la última respuesta.
 */
export async function cerrarEntregasB2b(
  api: ReturnType<typeof apiRol>,
  pedidoId: string,
  estado: 'ENTREGADA' | 'NO_RECOGIDA' = 'ENTREGADA',
) {
  const detalle = await api.get(`/pedidos-b2b/${pedidoId}`).expect(200);
  let ultimo = detalle.body;
  for (const e of detalle.body.entregas.filter(
    (x: { estado: string }) => x.estado === 'PENDIENTE',
  )) {
    ultimo = (
      await api
        .patch(`/pedidos-b2b/${pedidoId}/entregas/${e.id}/cerrar`)
        .send({ estado })
        .expect(200)
    ).body;
  }
  return ultimo;
}

let contadorClientes = 0;

/**
 * Fase 2 (clientes B2B): un pedido B2B pertenece a un cliente dado de alta. `bodyB2b` conserva los campos de contacto
 * («negocioNombre», «contactoNombre», «contactoTelefono», «codigoDescuento») solo como DESCRIPCIÓN del cliente de la
 * prueba: aquí se convierten en el alta de un cliente B2B nuevo (uno por llamada, para no chocar con «un pedido por
 * cliente por semana») y el pedido se captura con su `clienteId`. `codigoDescuento` se vuelve el % de descuento del cliente.
 * Para repetir cliente se pasa `clienteId`.
 */
export async function altaClienteB2bDePrueba(
  h: Harness,
  base: BaseSeed,
  extra: Record<string, unknown> = {},
) {
  const negocio =
    (extra.negocioNombre as string | undefined) ?? 'Cafetería La Esquina';
  let descuento: number | null =
    (extra.descuentoPorcentaje as number | undefined) ?? null;
  if (typeof extra.codigoDescuento === 'string') {
    const codigo = await h.prisma.pedidoB2bCodigoDescuento.findFirstOrThrow({
      where: {
        tenantId: base.tenant.id,
        codigo: extra.codigoDescuento.toUpperCase(),
      },
    });
    descuento = Number(codigo.descuentoPorcentaje);
  }
  const cliente = await crearClienteB2b(h.prisma, {
    tenantId: base.tenant.id,
    tenantSlug: base.tenant.slug,
    sufijo: `${slugificar(negocio)}-${++contadorClientes}`,
    nombre: negocio,
    direccion: 'Calle de Prueba 123',
    descuentoPorcentaje: descuento,
    modalidadPago:
      (extra.modalidadPago as 'AL_INICIO' | 'AL_FINAL' | undefined) ?? null,
    telefonos: [
      {
        // Las pruebas usan teléfonos de fantasía a veces cortos: se completan a 10 dígitos.
        telefono: (
          (extra.contactoTelefono as string | undefined) ?? '5533334444'
        )
          .replace(/\D/g, '')
          .padEnd(10, '0'),
        principal: true,
        nombreContacto:
          (extra.contactoNombre as string | undefined) ?? 'Luis Compras',
      },
    ],
  });
  // El correo del contacto vive en Cliente.correo (no hay API de alta que lo capture): se fija directo para las pruebas.
  const correo =
    (extra.contactoCorreo as string | undefined) ?? 'compras@laesquina.test';
  return h.prisma.cliente.update({
    where: { id: cliente.id },
    data: { correo },
  });
}

/** Cuerpo de POST /pedidos-b2b a partir del cuerpo «de prueba» (crea el cliente si no viene `clienteId`). */
export async function cuerpoPanelB2b(
  h: Harness,
  base: BaseSeed,
  extra: Record<string, unknown> = {},
) {
  const body = bodyB2b(base, extra);
  const clienteId =
    (extra.clienteId as string | undefined) ??
    (await altaClienteB2bDePrueba(h, base, extra)).id;
  return {
    clienteId,
    semanaInicio: body.semanaInicio,
    items: body.items,
    ...(extra.notaCliente ? { notaCliente: extra.notaCliente } : {}),
  };
}

/** Crea un pedido B2B por el panel (POST /pedidos-b2b) y devuelve el body. */
export async function crearAdminB2b(
  h: Harness,
  base: BaseSeed,
  extra: Record<string, unknown> = {},
) {
  const res = await apiRol(h, base, 'DUENO')
    .post('/pedidos-b2b')
    .send(await cuerpoPanelB2b(h, base, extra));
  if (res.status !== 201)
    throw new Error(`crearAdminB2b: ${res.status} ${JSON.stringify(res.body)}`);
  const pedido = res.body;
  // `codigoDescuento` ya no existe como entrada de la API (el descuento es del cliente), pero los pedidos HISTÓRICOS con código
  // siguen existiendo: se reproduce ese dato dejando en el pedido el snapshot del código, como lo dejaba el flujo anterior.
  if (typeof extra.codigoDescuento === 'string') {
    const codigo = await h.prisma.pedidoB2bCodigoDescuento.findFirstOrThrow({
      where: {
        tenantId: base.tenant.id,
        codigo: extra.codigoDescuento.toUpperCase(),
      },
    });
    await h.prisma.detalleB2B.update({
      where: { orderId: pedido.id },
      data: {
        codigoDescuentoId: codigo.id,
        codigoDescuentoTexto: codigo.codigo,
      },
    });
    return {
      ...pedido,
      codigoDescuentoId: codigo.id,
      codigoDescuentoTexto: codigo.codigo,
    };
  }
  return pedido;
}

/**
 * Antes creaba el pedido por el storefront público; ese POST ya está cerrado (409). Se conserva el nombre para no tocar
 * decenas de pruebas: ahora captura el pedido por el panel, igual que `crearAdminB2b`.
 */
export const crearPublicoB2b = crearAdminB2b;

// ---------------------------------------------------------------------------
// Plantillas de respuesta (ya normalizadas). El pedido B2B se serializa con
// items + distribucion; `codigoDescuento` solo en findOne.
// ---------------------------------------------------------------------------

export function diaEsperado(dia: DiaSemana, cantidad: number, idx = 0) {
  return {
    id: '<uuid>',
    tenantId: '<tenant>',
    pedidoB2bItemId: `<item${idx}>`,
    dia,
    cantidad,
  };
}

/** `idx`: posición del item en el pedido (el id del item se etiqueta como <item0>, <item1>...). */
export function itemB2bEsperado(
  overrides: Record<string, unknown> = {},
  idx = 0,
) {
  return {
    id: `<item${idx}>`,
    tenantId: '<tenant>',
    pedidoB2bId: '<pedido>',
    productId: '<productoA>',
    nombreProducto: 'Café americano',
    precioUnitario: '45',
    cantidadTotal: 12,
    distribucion: [
      diaEsperado('LUNES', 6, idx),
      diaEsperado('MIERCOLES', 6, idx),
    ],
    ...overrides,
  };
}

/** Una entrega tal como la expone GET /pedidos-b2b/:id (con `fecha`/`id` normalizados). */
export function entregaEsperada(
  dia: DiaSemana,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: '<uuid>',
    fecha: '<iso>',
    dia,
    estado: 'PENDIENTE',
    cerradaAt: null,
    atrasada: false,
    ...overrides,
  };
}

/** Pedido B2B por defecto de bodyB2b (AL_FINAL, sin factura ni código, 16 piezas, $662). */
export function pedidoB2bEsperado(overrides: Record<string, unknown> = {}) {
  return {
    id: '<pedido>',
    tenantId: '<tenant>',
    folio: 'P-000001',
    negocioNombre: 'Cafetería La Esquina',
    contactoNombre: 'Luis Compras',
    contactoTelefono: '5533334444',
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
  pedido?: {
    id: string;
    clienteId: string;
    items?: { id: string; distribucion?: unknown[] }[];
  },
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
