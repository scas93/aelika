// Demo seed for Panadería Banetto, sourced from a real menu export
// (prisma/data/seed-banetto-menu.json). Independent from prisma/seed.ts
// (the main dev seed) on purpose — this one is for demoing/piloting with a
// specific business, not for local dev bootstrap. Run with `npm run
// seed:banetto`.
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { generateApiKey } from '../src/common/api-key';
import { normalizarHorarioSemana, type HorarioSemana } from '../src/common/horario';
import { Role } from '../generated/prisma/enums';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

interface MenuProducto {
  nombre: string;
  descripcion?: string;
  precio: number;
  fotoUrl: string | null;
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
    logoUrl: string;
    ubicacion: string;
    mensajeBienvenida: string;
    horarioAtencion: HorarioSemana;
    duenoDemo: { email: string; nombre: string; password: string };
  };
  categorias: MenuCategoria[];
}

function loadMenu(): MenuData {
  const filePath = path.join(__dirname, 'data', 'seed-banetto-menu.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// Category/Product have no natural unique key besides `id` (same as
// prisma/seed.ts), so this is find-then-create-or-update, not a real
// upsert() — but it's still idempotent and re-running it picks up JSON
// edits (price changes, new fotoUrl, etc.) instead of only skipping.
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
    disponible: true,
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

  const tenant = await prisma.tenant.upsert({
    where: { slug: menu.tenant.slug },
    update: {
      nombre: menu.tenant.nombre,
      logoUrl: menu.tenant.logoUrl,
      ubicacion: menu.tenant.ubicacion,
      mensajeBienvenida: menu.tenant.mensajeBienvenida,
      horarioAtencion,
    },
    create: {
      slug: menu.tenant.slug,
      nombre: menu.tenant.nombre,
      logoUrl: menu.tenant.logoUrl,
      ubicacion: menu.tenant.ubicacion,
      mensajeBienvenida: menu.tenant.mensajeBienvenida,
      horarioAtencion,
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

  console.log(`Seed de Banetto listo: tenant "${tenant.slug}"`);
  console.log(`  ${menu.tenant.duenoDemo.email} / ${menu.tenant.duenoDemo.password} (DUENO)`);
  console.log(`  ${menu.categorias.length} categorías, ${totalProductos} productos`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
