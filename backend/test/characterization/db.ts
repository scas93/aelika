import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';

/** Estado limpio y conocido: vacía todas las tablas salvo _prisma_migrations. */
export async function truncateAll(prisma: PrismaService) {
  const filas = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (filas.length === 0) return;
  const lista = filas.map((f) => `"${f.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`);
}

const DIAS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const;

export function horarioAbierto(apertura = '08:00', cierre = '22:00') {
  return Object.fromEntries(DIAS.map((d) => [d, { abierto: true, apertura, cierre }]));
}

export interface BaseSeed {
  tenant: { id: string; slug: string };
  dueno: { id: string; email: string };
  operador: { id: string; email: string };
  categoria: { id: string };
  productoA: { id: string; nombre: string; precio: string };
  productoB: { id: string; nombre: string; precio: string };
}

/**
 * ÚNICO punto de inserción directa (datos base: tenant, usuarios, catálogo).
 * Los pedidos siempre se crean por el POST de checkout. Si el refactor
 * cambia la forma de las tablas, este helper es lo que se ajusta.
 */
export async function seedBase(
  prisma: PrismaService,
  opts: {
    slug?: string;
    horario?: unknown;
    facturacionModo?: 'OBLIGATORIO' | 'OPCIONAL' | 'DESACTIVADO';
    /** RETAIL_B2B además configura el módulo B2B con un mínimo BAJO (10 piezas, no el default 100). */
    tipoStorefront?: 'RETAIL_B2C' | 'RETAIL_B2B';
    b2b?: ConfigB2b;
  } = {},
): Promise<BaseSeed> {
  const slug = opts.slug ?? 'cafe-test';
  const tenant = await prisma.tenant.create({
    data: {
      slug,
      nombre: `Negocio ${slug}`,
      botApiKey: `key-${slug}`,
      horarioAtencion: (opts.horario ?? horarioAbierto()) as Prisma.InputJsonValue,
      facturacionModo: opts.facturacionModo ?? 'DESACTIVADO',
      tipoStorefront: opts.tipoStorefront ?? 'RETAIL_B2C',
      ...(opts.tipoStorefront === 'RETAIL_B2B' || opts.b2b ? datosConfigB2b({ modoCobro: 'AL_FINAL', minimoPiezas: 10, ...opts.b2b }) : {}),
    },
  });
  const mkUser = (rol: 'DUENO' | 'OPERADOR') =>
    prisma.user.create({
      data: {
        tenantId: tenant.id,
        nombre: rol === 'DUENO' ? 'Dueño Test' : 'Operador Test',
        email: `${rol.toLowerCase()}@${slug}.test`,
        passwordHash: 'no-se-usa-en-tests',
        rol,
      },
    });
  const [dueno, operador] = await Promise.all([mkUser('DUENO'), mkUser('OPERADOR')]);
  const categoria = await prisma.category.create({ data: { tenantId: tenant.id, nombre: 'Bebidas' } });
  const productoA = await prisma.product.create({
    data: { tenantId: tenant.id, categoryId: categoria.id, nombre: 'Café americano', precio: '45.00' },
  });
  const productoB = await prisma.product.create({
    data: { tenantId: tenant.id, categoryId: categoria.id, nombre: 'Concha', precio: '30.50' },
  });
  return {
    tenant: { id: tenant.id, slug },
    dueno: { id: dueno.id, email: dueno.email },
    operador: { id: operador.id, email: operador.email },
    categoria: { id: categoria.id },
    productoA: { id: productoA.id, nombre: productoA.nombre, precio: '45.00' },
    productoB: { id: productoB.id, nombre: productoB.nombre, precio: '30.50' },
  };
}

// ---------------------------------------------------------------------------
// Datos base adicionales (catálogo/config). También inserción directa: no son
// pedidos. Ajustar aquí si el refactor cambia la forma de estas tablas.
// ---------------------------------------------------------------------------

export async function seedPuntoEnvio(
  prisma: PrismaService,
  tenantId: string,
  opts: { nombre?: string; direccion?: string; pedidoMinimo?: string | null; activo?: boolean } = {},
) {
  return prisma.puntoEnvio.create({
    data: {
      tenantId,
      nombre: opts.nombre ?? 'Zona Centro',
      direccion: opts.direccion ?? 'Av. Reforma 100, Centro',
      pedidoMinimo: opts.pedidoMinimo === undefined ? null : opts.pedidoMinimo,
      activo: opts.activo ?? true,
    },
  });
}

/** Grupo de modificadores con opciones, asignado a un producto. */
export async function seedModificadores(
  prisma: PrismaService,
  tenantId: string,
  productId: string,
  opts: {
    nombre?: string;
    tipoSeleccion?: 'UNICA' | 'MULTIPLE';
    obligatorio?: boolean;
    orden?: number;
    opciones: { nombre: string; precioAdicional: string }[];
  },
) {
  const grupo = await prisma.modifierGroup.create({
    data: {
      tenantId,
      nombre: opts.nombre ?? 'Tamaño',
      tipoSeleccion: opts.tipoSeleccion ?? 'UNICA',
      obligatorio: opts.obligatorio ?? false,
    },
  });
  const opciones = [];
  for (const o of opts.opciones) {
    opciones.push(
      await prisma.modifierOption.create({
        data: { tenantId, modifierGroupId: grupo.id, nombre: o.nombre, precioAdicional: o.precioAdicional },
      }),
    );
  }
  await prisma.productModifierGroup.create({
    data: { productId, modifierGroupId: grupo.id, orden: opts.orden ?? 0 },
  });
  return { grupo, opciones };
}

export async function seedPromocion(
  prisma: PrismaService,
  tenantId: string,
  tipo: 'COMBO' | 'DESCUENTO_PRODUCTO',
  config: Prisma.InputJsonValue,
) {
  return prisma.promotion.create({ data: { tenantId, tipo, config } });
}

/** Marca el tenant como con Stripe Connect activo (habilita TARJETA). */
export async function conectarStripe(prisma: PrismaService, tenantId: string, chargesEnabled = true) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { stripeAccountId: `acct_char_${tenantId.slice(0, 8)}`, stripeChargesEnabled: chargesEnabled },
  });
}

// ---------------------------------------------------------------------------
// Módulo B2B (PedidoB2b). Configuración del tenant y catálogo de códigos.
// ---------------------------------------------------------------------------

export interface ConfigB2b {
  modoCobro?: 'AL_INICIO' | 'AL_FINAL';
  /** Mínimo de piezas para confirmar. El default de la BD es 100: aquí los tests lo fijan explícito. */
  minimoPiezas?: number;
  /** null = sin ventana de recepción (siempre abierto). */
  ventana?: {
    aperturaDia: string;
    aperturaHora: string;
    cierreDia: string;
    cierreHora: string;
  } | null;
}

function datosConfigB2b(c: ConfigB2b): Prisma.TenantUncheckedUpdateInput {
  return {
    ...(c.modoCobro ? { pedidoB2bModoCobro: c.modoCobro } : {}),
    ...(c.minimoPiezas !== undefined ? { pedidoB2bMinimoPiezas: c.minimoPiezas } : {}),
    ...(c.ventana === null
      ? {
          pedidoB2bVentanaAperturaDia: null,
          pedidoB2bVentanaAperturaHora: null,
          pedidoB2bVentanaCierreDia: null,
          pedidoB2bVentanaCierreHora: null,
        }
      : c.ventana
        ? {
            pedidoB2bVentanaAperturaDia: c.ventana.aperturaDia as any,
            pedidoB2bVentanaAperturaHora: c.ventana.aperturaHora,
            pedidoB2bVentanaCierreDia: c.ventana.cierreDia as any,
            pedidoB2bVentanaCierreHora: c.ventana.cierreHora,
          }
        : {}),
  };
}

/** Cambia la configuración B2B de un tenant a media prueba (p. ej. pasar a AL_INICIO). */
export async function configurarB2b(prisma: PrismaService, tenantId: string, c: ConfigB2b) {
  await prisma.tenant.update({ where: { id: tenantId }, data: datosConfigB2b(c) as any });
}

export async function seedCodigoDescuento(
  prisma: PrismaService,
  tenantId: string,
  opts: { codigo?: string; porcentaje?: string; activo?: boolean; usosMaximos?: number | null; fechaLimite?: string | null } = {},
) {
  return prisma.pedidoB2bCodigoDescuento.create({
    data: {
      tenantId,
      codigo: opts.codigo ?? 'PROMO10',
      descuentoPorcentaje: opts.porcentaje ?? '10.00',
      activo: opts.activo ?? true,
      usosMaximos: opts.usosMaximos ?? null,
      fechaLimite: opts.fechaLimite ? new Date(`${opts.fechaLimite}T00:00:00.000Z`) : null,
    },
  });
}
