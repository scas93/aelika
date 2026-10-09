import { BadRequestException, ConflictException } from '@nestjs/common';
import { Cliente, ClienteCanal, PedidoB2bModoCobro, Prisma } from '../../generated/prisma/client';
import { normalizarTelefono } from '../common/telefono';

/**
 * Base de los clientes B2B (extienden Cliente con canal = B2B; ver docs/diseno-operacion.md). Las reglas que no
 * dependen de HTTP viven aquí para que el servicio de la API (entrega 2c) y los seeds usen exactamente las mismas.
 *
 * Recibe el cliente Prisma como parámetro (raíz o transacción) y siempre un tenantId explícito: sirve igual con
 * sesión JWT que desde un script, y no depende de TenantPrismaService.
 */
export type ClienteB2bDb = Pick<Prisma.TransactionClient, 'cliente' | 'clienteTelefono'>;

export interface TelefonoB2bInput {
  telefono: string;
  principal?: boolean;
  nombreContacto?: string | null;
}

export interface CrearClienteB2bInput {
  tenantId: string;
  tenantSlug: string;
  /** Slug del cliente, sin el prefijo del negocio (ej. "matriz"). */
  sufijo: string;
  nombre: string;
  direccion: string;
  descuentoPorcentaje?: number | null;
  modalidadPago?: PedidoB2bModoCobro | null;
  telefonos: TelefonoB2bInput[];
}

/** "Américas Sur" → "americas-sur": minúsculas, sin acentos, solo [a-z0-9-]. */
export function slugificar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Código de cliente: `{slug del negocio}-{slug del cliente}`. Lanza 400 si el sufijo queda vacío. */
export function construirCodigoCliente(tenantSlug: string, sufijo: string): string {
  const limpio = slugificar(sufijo);
  if (!limpio) {
    throw new BadRequestException('El código del cliente no puede quedar vacío (usa letras o números)');
  }
  return `${tenantSlug}-${limpio}`;
}

/**
 * Valida y normaliza los teléfonos de un cliente B2B: al menos 1, sin repetidos y exactamente 1 principal
 * (si ninguno viene marcado, el primero lo es; si vienen varios marcados, 400).
 */
export function normalizarTelefonosB2b(telefonos: TelefonoB2bInput[]) {
  if (telefonos.length === 0) {
    throw new BadRequestException('El cliente necesita al menos un teléfono autorizado');
  }
  const normalizados = telefonos.map((t) => ({
    telefono: normalizarTelefono(t.telefono),
    principal: !!t.principal,
    nombreContacto: t.nombreContacto?.trim() || null,
  }));
  if (normalizados.some((t) => t.telefono.length < 10)) {
    throw new BadRequestException('Cada teléfono debe tener 10 dígitos');
  }
  if (new Set(normalizados.map((t) => t.telefono)).size !== normalizados.length) {
    throw new BadRequestException('Hay teléfonos repetidos en el cliente');
  }
  const marcados = normalizados.filter((t) => t.principal).length;
  if (marcados > 1) {
    throw new BadRequestException('Solo un teléfono puede ser el principal');
  }
  if (marcados === 0) {
    normalizados[0].principal = true;
  }
  return normalizados;
}

/** Alta de un cliente B2B con sus teléfonos. 409 si el código ya existe en el negocio. */
export async function crearClienteB2b(db: ClienteB2bDb, input: CrearClienteB2bInput): Promise<Cliente> {
  const codigo = construirCodigoCliente(input.tenantSlug, input.sufijo);
  const telefonos = normalizarTelefonosB2b(input.telefonos);
  const nombre = input.nombre.trim();
  const direccion = input.direccion.trim();
  if (!nombre || !direccion) {
    throw new BadRequestException('El nombre comercial y la dirección son obligatorios');
  }
  const descuento = input.descuentoPorcentaje ?? null;
  if (descuento !== null && (descuento < 0 || descuento > 100)) {
    throw new BadRequestException('El descuento debe estar entre 0 y 100');
  }

  const existente = await db.cliente.findFirst({ where: { tenantId: input.tenantId, codigo } });
  if (existente) {
    throw new ConflictException(`Ya existe un cliente con el código ${codigo}`);
  }

  // Un B2B nunca tiene Cliente.telefono: sus números viven en ClienteTelefono. Los contadores nacen en 0 y
  // las fechas = fecha de alta, igual que cualquier Cliente sin pedidos contables (ver cliente-contadores.ts).
  const ahora = new Date();
  const cliente = await db.cliente.create({
    data: {
      tenantId: input.tenantId,
      canal: ClienteCanal.B2B,
      telefono: null,
      codigo,
      nombre,
      direccion,
      descuentoPorcentaje: descuento && descuento > 0 ? descuento : null,
      modalidadPago: input.modalidadPago ?? null,
      primerPedidoAt: ahora,
      ultimoPedidoAt: ahora,
      totalPedidos: 0,
    },
  });
  // Escritura aparte (no nested create): ver la nota de TenantPrismaService sobre escrituras anidadas.
  await db.clienteTelefono.createMany({
    data: telefonos.map((t) => ({ ...t, tenantId: input.tenantId, clienteId: cliente.id })),
  });
  return cliente;
}

/**
 * Teléfono (10 dígitos) al que le llegan las notificaciones de un cliente: el propio en B2C, el principal en B2B.
 * null si no hay a quién mandar (un B2B siempre debería tener principal; el caller registra el error y omite).
 */
export async function telefonoDestino(
  db: Pick<Prisma.TransactionClient, 'clienteTelefono'>,
  cliente: Pick<Cliente, 'id' | 'canal' | 'telefono'>,
): Promise<string | null> {
  if (cliente.canal === ClienteCanal.B2B) {
    const principal = await db.clienteTelefono.findFirst({
      where: { clienteId: cliente.id, principal: true },
      select: { telefono: true },
    });
    return principal?.telefono ?? null;
  }
  return cliente.telefono;
}

/**
 * Para los seeds: alta por código o, si ya existe, actualiza sus datos y reemplaza sus teléfonos (idempotente).
 * Los pedidos del cliente no se tocan. El código nunca cambia.
 */
export async function sembrarClienteB2b(db: ClienteB2bDb, input: CrearClienteB2bInput): Promise<Cliente> {
  const codigo = construirCodigoCliente(input.tenantSlug, input.sufijo);
  const existente = await db.cliente.findFirst({ where: { tenantId: input.tenantId, codigo } });
  if (!existente) return crearClienteB2b(db, input);

  const telefonos = normalizarTelefonosB2b(input.telefonos);
  const descuento = input.descuentoPorcentaje ?? null;
  const actualizado = await db.cliente.update({
    where: { id: existente.id },
    data: {
      nombre: input.nombre.trim(),
      direccion: input.direccion.trim(),
      descuentoPorcentaje: descuento && descuento > 0 ? descuento : null,
      modalidadPago: input.modalidadPago ?? null,
      bajaAt: null,
    },
  });
  await db.clienteTelefono.deleteMany({ where: { clienteId: existente.id } });
  await db.clienteTelefono.createMany({
    data: telefonos.map((t) => ({ ...t, tenantId: input.tenantId, clienteId: existente.id })),
  });
  return actualizado;
}

/**
 * Campos de Cliente que solo existen en B2B. Las respuestas que exponen filas de Cliente B2C (directorio de
 * clientes del menudeo, Lealtad) los omiten para no cambiar su contrato; la API de clientes B2B (entrega 2c)
 * es la que los expone.
 */
export const OMITIR_CAMPOS_B2B = {
  codigo: true,
  direccion: true,
  descuentoPorcentaje: true,
  modalidadPago: true,
  bajaAt: true,
} as const;
