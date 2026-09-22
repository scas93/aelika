// Demo seed for "Dominique Ansel Bakery" — a RETAIL_B2B tenant modeled after
// https://www.dominiqueanselny.com/pre-order/, repurposed as a wholesale
// storefront for cafeterías/hoteles/eventos corporativos ordering by piece
// count (the Módulo de Pedidos B2B), not the individual-consumer pre-order
// flow the real site actually runs. Prices/quantities are demo values in
// MXN, not the real site's USD retail prices.
//
// Source data: prisma/data/seed-dominique-ansel-menu.json. Same
// find-then-create-or-update pattern as seed-banetto.ts/seed-reynoso.ts for
// Category/Product (no natural unique key besides `id`); Tenant/User use a
// real upsert() (slug/email are unique).
//
// Deliberately left unset (environment/tenant-specific, same as other demo
// seeds): botApiKey is generated fresh only on first create (upsert `create`
// branch), Stripe Connect fields are left unset (manual onboarding via
// /dashboard/configuracion, not something a seed can fill in).
//
// Run with `npm run seed:dominique-ansel` from backend/, DATABASE_URL
// pointing at the target database (this script never connects anywhere on
// its own).
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
  const filePath = path.join(__dirname, 'data', 'seed-dominique-ansel-menu.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

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

  console.log(`Seed de Dominique Ansel Bakery listo: tenant "${tenant.slug}" (${tenant.tipoStorefront})`);
  console.log(`  ${menu.tenant.duenoDemo.email} / ${menu.tenant.duenoDemo.password} (DUENO)`);
  console.log(`  ${menu.categorias.length} categorías, ${totalProductos} productos`);
  console.log(`  ${menu.codigosDescuento.length} código(s) de descuento B2B`);
  console.log('');
  console.log('Pendiente de configurar manualmente en este ambiente:');
  console.log(`  - botApiKey (Botpress): ${tenant.botApiKey}`);
  console.log('  - Cobros con tarjeta (Stripe Connect): no conectado.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
