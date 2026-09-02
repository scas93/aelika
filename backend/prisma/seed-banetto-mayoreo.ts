// Staging seed for "Panadería Banetto Mayoreo" — a replica of the
// panaderia-aurora tenant (RETAIL_B2B, created by hand in the local DB, no
// seed script of its own) with the same catalog/menu, horarioAtencion, and
// Pedidos B2B config (minimoPiezas, modoCobro, ventana de recepción).
//
// Targets the existing staging tenant `banetto-mayorista` (found already
// present in staging with this exact catalog/config under a placeholder
// name from an earlier attempt) rather than creating a new slug — this
// script's job here is bringing that tenant's nombre and B2B config up to
// date, not creating a duplicate. See seed-banetto-mayoreo-menu.json for the
// slug. The npm script keeps the "mayoreo" name (matches the requested
// business name) even though the tenant slug itself is "mayorista".
//
// Source data: prisma/data/seed-banetto-mayoreo-menu.json (catalog copied
// verbatim from panaderia-aurora, including its `disponible: false` items).
//
// Deliberately NOT copied from panaderia-aurora (environment/tenant-specific,
// would be invalid in staging):
//   - botApiKey: generated fresh per environment only if the tenant doesn't
//     already have one (generateApiKey() below, upsert `create` branch only).
//     banetto-mayorista already has its own staging botApiKey — untouched.
//   - stripeAccountId / stripeChargesEnabled / stripePayoutsEnabled /
//     stripeContactEmail: left unset (same as aurora today — aurora has no
//     card payments enabled). If staging ever needs Stripe Connect for this
//     tenant, that's a manual onboarding step via /dashboard/configuracion,
//     not something this seed can fill in.
//   - pedido_b2b_codigos_descuento: aurora's real code is named "AURORA10" —
//     renamed here to "MAYORISTA10" to match this tenant's own slug/identity.
//     Same 10% discount, no usosMaximos/fechaLimite (matches aurora's
//     config).
//
// Run with `npm run seed:banetto-mayoreo` from backend/, DATABASE_URL
// pointing at the target database (staging connection is a manual step, see
// project notes — this script never connects anywhere on its own).
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { generateApiKey } from '../src/common/api-key';
import { normalizarHorarioSemana, type HorarioSemana } from '../src/common/horario';
import { Role, TipoStorefront, FacturacionModo, PedidoB2bModoCobro, DiaSemana } from '../generated/prisma/enums';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

interface MenuProducto {
  nombre: string;
  descripcion?: string;
  precio: number;
  fotoUrl: string | null;
  disponible: boolean;
}

interface MenuCategoria {
  nombre: string;
  orden: number;
  productos: MenuProducto[];
}

interface MenuData {
  tenant: {
    nombre: string;
    slug: string;
    logoUrl: string | null;
    ubicacion: string | null;
    mensajeBienvenida: string | null;
    tipoStorefront: keyof typeof TipoStorefront;
    facturacionModo: keyof typeof FacturacionModo;
    horarioAtencion: HorarioSemana;
    pedidoB2b: {
      minimoPiezas: number;
      modoCobro: keyof typeof PedidoB2bModoCobro;
      ventanaAperturaDia: keyof typeof DiaSemana;
      ventanaAperturaHora: string;
      ventanaCierreDia: keyof typeof DiaSemana;
      ventanaCierreHora: string;
    };
    duenoDemo: { email: string; nombre: string; password: string };
  };
  codigosDescuento: {
    codigo: string;
    descuentoPorcentaje: number;
    activo: boolean;
    usosMaximos: number | null;
    fechaLimite: string | null;
  }[];
  categorias: MenuCategoria[];
}

function loadMenu(): MenuData {
  const filePath = path.join(__dirname, 'data', 'seed-banetto-mayoreo-menu.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// Same find-then-create-or-update pattern as seed-banetto.ts/seed.ts —
// Category/Product have no natural unique key besides `id`.
async function ensureCategory(tenantId: string, nombre: string, orden: number) {
  const existing = await prisma.category.findFirst({ where: { tenantId, nombre } });
  if (existing) {
    return prisma.category.update({ where: { id: existing.id }, data: { orden } });
  }
  return prisma.category.create({ data: { tenantId, nombre, orden } });
}

async function ensureProduct(tenantId: string, categoryId: string, producto: MenuProducto) {
  const existing = await prisma.product.findFirst({ where: { tenantId, nombre: producto.nombre } });
  const data = {
    categoryId,
    descripcion: producto.descripcion ?? null,
    precio: producto.precio,
    fotoUrl: producto.fotoUrl,
    disponible: producto.disponible,
  };
  if (existing) {
    return prisma.product.update({ where: { id: existing.id }, data });
  }
  return prisma.product.create({ data: { tenantId, nombre: producto.nombre, ...data } });
}

async function main() {
  const menu = loadMenu();

  const duenoPasswordHash = await bcrypt.hash(menu.tenant.duenoDemo.password, 10);
  const horarioAtencion = normalizarHorarioSemana(menu.tenant.horarioAtencion) as any;

  const tenantData = {
    nombre: menu.tenant.nombre,
    logoUrl: menu.tenant.logoUrl,
    ubicacion: menu.tenant.ubicacion,
    mensajeBienvenida: menu.tenant.mensajeBienvenida,
    horarioAtencion,
    tipoStorefront: TipoStorefront[menu.tenant.tipoStorefront],
    facturacionModo: FacturacionModo[menu.tenant.facturacionModo],
    pedidoB2bMinimoPiezas: menu.tenant.pedidoB2b.minimoPiezas,
    pedidoB2bModoCobro: PedidoB2bModoCobro[menu.tenant.pedidoB2b.modoCobro],
    pedidoB2bVentanaAperturaDia: DiaSemana[menu.tenant.pedidoB2b.ventanaAperturaDia],
    pedidoB2bVentanaAperturaHora: menu.tenant.pedidoB2b.ventanaAperturaHora,
    pedidoB2bVentanaCierreDia: DiaSemana[menu.tenant.pedidoB2b.ventanaCierreDia],
    pedidoB2bVentanaCierreHora: menu.tenant.pedidoB2b.ventanaCierreHora,
  };

  const tenant = await prisma.tenant.upsert({
    where: { slug: menu.tenant.slug },
    update: tenantData,
    create: {
      slug: menu.tenant.slug,
      ...tenantData,
      botApiKey: generateApiKey(),
    },
  });

  await prisma.user.upsert({
    where: { email: menu.tenant.duenoDemo.email },
    update: {},
    create: {
      tenantId: tenant.id,
      nombre: menu.tenant.duenoDemo.nombre,
      email: menu.tenant.duenoDemo.email,
      passwordHash: duenoPasswordHash,
      rol: Role.DUENO,
    },
  });

  let totalProductos = 0;
  for (const categoria of menu.categorias) {
    const created = await ensureCategory(tenant.id, categoria.nombre, categoria.orden);
    for (const producto of categoria.productos) {
      await ensureProduct(tenant.id, created.id, producto);
      totalProductos += 1;
    }
  }

  // PedidoB2bCodigoDescuento has a real unique key (tenantId+codigo), so a
  // real upsert() works here — unlike Category/Product above.
  for (const codigo of menu.codigosDescuento) {
    await prisma.pedidoB2bCodigoDescuento.upsert({
      where: { tenantId_codigo: { tenantId: tenant.id, codigo: codigo.codigo } },
      update: {
        descuentoPorcentaje: codigo.descuentoPorcentaje,
        activo: codigo.activo,
        usosMaximos: codigo.usosMaximos,
        fechaLimite: codigo.fechaLimite,
      },
      create: {
        tenantId: tenant.id,
        codigo: codigo.codigo,
        descuentoPorcentaje: codigo.descuentoPorcentaje,
        activo: codigo.activo,
        usosMaximos: codigo.usosMaximos,
        fechaLimite: codigo.fechaLimite,
      },
    });
  }

  console.log(`Seed de Banetto Mayoreo listo: tenant "${tenant.slug}" (${tenant.tipoStorefront})`);
  console.log(`  ${menu.tenant.duenoDemo.email} / ${menu.tenant.duenoDemo.password} (DUENO)`);
  console.log(`  ${menu.categorias.length} categorías, ${totalProductos} productos`);
  console.log(`  ${menu.codigosDescuento.length} código(s) de descuento B2B`);
  console.log('');
  console.log('Pendiente de configurar manualmente en este ambiente (no copiado de aurora):');
  console.log(`  - botApiKey (Botpress): ${tenant.botApiKey}`);
  console.log('  - Cobros con tarjeta (Stripe Connect): no conectado, igual que aurora hoy.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
