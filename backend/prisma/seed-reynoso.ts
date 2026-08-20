// Demo seed for Envases Reynoso, sourced from a real menu export
// (prisma/data/seed-reynoso-catalogo.json). Independent from prisma/seed.ts
// and prisma/seed-banetto.ts on purpose — this one is for demoing/piloting
// with a specific business (envío a domicilio + facturación opcional), not
// for local dev bootstrap. Run with `npm run seed:reynoso`.
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { generateApiKey } from '../src/common/api-key';
import { normalizarHorarioSemana, type HorarioSemana } from '../src/common/horario';
import { Role, FacturacionModo } from '../generated/prisma/enums';

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
    facturacionModo: keyof typeof FacturacionModo;
    horarioAtencion: HorarioSemana;
    equipo: { email: string; nombre: string; password: string; rol: keyof typeof Role }[];
    puntosEnvio: { nombre: string; direccion: string; pedidoMinimo: number }[];
  };
  categorias: MenuCategoria[];
}

function loadMenu(): MenuData {
  const filePath = path.join(__dirname, 'data', 'seed-reynoso-catalogo.json');
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

// PuntoEnvio has no natural unique key besides `id` either (same reasoning
// as ensureCategory/ensureProduct above) — find-then-create-or-update keyed
// on (tenantId, nombre) so re-running the seed after a JSON edit (e.g. a
// pedidoMinimo change) updates in place instead of duplicating.
async function ensurePuntoEnvio(tenantId: string, punto: { nombre: string; direccion: string; pedidoMinimo: number }) {
  const existing = await prisma.puntoEnvio.findFirst({ where: { tenantId, nombre: punto.nombre } });
  const data = { direccion: punto.direccion, pedidoMinimo: punto.pedidoMinimo };
  if (existing) {
    return prisma.puntoEnvio.update({ where: { id: existing.id }, data });
  }
  return prisma.puntoEnvio.create({ data: { tenantId, nombre: punto.nombre, ...data } });
}

async function main() {
  const menu = loadMenu();
  const horarioAtencion = normalizarHorarioSemana(menu.tenant.horarioAtencion) as any;

  const tenant = await prisma.tenant.upsert({
    where: { slug: menu.tenant.slug },
    update: {
      nombre: menu.tenant.nombre,
      logoUrl: menu.tenant.logoUrl,
      ubicacion: menu.tenant.ubicacion,
      mensajeBienvenida: menu.tenant.mensajeBienvenida,
      facturacionModo: FacturacionModo[menu.tenant.facturacionModo],
      horarioAtencion,
    },
    create: {
      slug: menu.tenant.slug,
      nombre: menu.tenant.nombre,
      logoUrl: menu.tenant.logoUrl,
      ubicacion: menu.tenant.ubicacion,
      mensajeBienvenida: menu.tenant.mensajeBienvenida,
      facturacionModo: FacturacionModo[menu.tenant.facturacionModo],
      horarioAtencion,
      botApiKey: generateApiKey(),
    },
  });

  for (const miembro of menu.tenant.equipo) {
    const passwordHash = await bcrypt.hash(miembro.password, 10);
    await prisma.user.upsert({
      where: { email: miembro.email },
      update: {},
      create: {
        tenantId: tenant.id,
        nombre: miembro.nombre,
        email: miembro.email,
        passwordHash,
        rol: Role[miembro.rol],
      },
    });
  }

  for (const punto of menu.tenant.puntosEnvio) {
    await ensurePuntoEnvio(tenant.id, punto);
  }

  let totalProductos = 0;
  for (const categoria of menu.categorias) {
    const created = await ensureCategory(tenant.id, categoria.nombre, categoria.orden);
    for (const producto of categoria.productos) {
      await ensureProduct(tenant.id, created.id, producto);
      totalProductos += 1;
    }
  }

  console.log(`Seed de Envases Reynoso listo: tenant "${tenant.slug}" (facturacionModo=${tenant.facturacionModo})`);
  for (const miembro of menu.tenant.equipo) {
    console.log(`  ${miembro.email} / ${miembro.password} (${miembro.rol})`);
  }
  console.log(`  ${menu.tenant.puntosEnvio.length} puntos de envío`);
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
