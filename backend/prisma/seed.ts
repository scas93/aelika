import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  Role,
  PromotionTipo,
  EstadoPedido,
  HoraRecogidaTipo,
  MetodoPago,
  CanalOrigen,
} from '../generated/prisma/client';
import { horarioSemanaVacio, type HorarioSemana } from '../src/common/horario';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function horarioTodosLosDias(apertura: string, cierre: string): HorarioSemana {
  const horario = horarioSemanaVacio();
  for (const dia of Object.keys(horario) as (keyof HorarioSemana)[]) {
    horario[dia] = { abierto: true, apertura, cierre };
  }
  return horario;
}

// Category/Product/Promotion have no natural unique key besides `id`, so
// upsert() isn't an option — find-then-create keeps the seed idempotent.
async function ensureCategory(tenantId: string, nombre: string, orden: number) {
  const existing = await prisma.category.findFirst({ where: { tenantId, nombre } });
  if (existing) return existing;
  return prisma.category.create({ data: { tenantId, nombre, orden } });
}

async function ensureProduct(tenantId: string, categoryId: string, nombre: string, precio: number) {
  const existing = await prisma.product.findFirst({ where: { tenantId, nombre } });
  if (existing) return existing;
  return prisma.product.create({ data: { tenantId, categoryId, nombre, precio } });
}

async function ensurePromotion(tenantId: string, tipo: PromotionTipo, config: object) {
  const existing = await prisma.promotion.findFirst({ where: { tenantId, tipo } });
  if (existing) return existing;
  return prisma.promotion.create({ data: { tenantId, tipo, config, activa: true } });
}

interface OrderSeedInput {
  clienteNombre: string;
  clienteTelefono: string;
  estadoPedido: EstadoPedido;
  horaRecogidaTipo: HoraRecogidaTipo;
  horaRecogida?: string;
  notas?: string;
  items: { productId: string; nombreProducto: string; precioUnitario: number; cantidad: number }[];
  descuentoTotal: number;
  notasDescuento?: string;
}

async function ensureOrder(tenantId: string, folio: string, input: OrderSeedInput) {
  const existing = await prisma.order.findFirst({ where: { tenantId, folio } });
  if (existing) return existing;

  const subtotal = input.items.reduce((sum, item) => sum + item.precioUnitario * item.cantidad, 0);

  return prisma.order.create({
    data: {
      tenantId,
      folio,
      clienteNombre: input.clienteNombre,
      clienteTelefono: input.clienteTelefono,
      notas: input.notas,
      horaRecogidaTipo: input.horaRecogidaTipo,
      horaRecogida: input.horaRecogida,
      metodoPago: MetodoPago.EFECTIVO,
      estadoPedido: input.estadoPedido,
      canalOrigen: CanalOrigen.WEB,
      descuentoTotal: input.descuentoTotal,
      notasDescuento: input.notasDescuento,
      total: subtotal - input.descuentoTotal,
      items: {
        create: input.items.map((item) => ({
          tenantId,
          productId: item.productId,
          nombreProducto: item.nombreProducto,
          precioUnitario: item.precioUnitario,
          cantidad: item.cantidad,
        })),
      },
    },
  });
}

async function main() {
  const duenoPasswordHash = await bcrypt.hash('demo1234', 10);
  const horarioAtencion = horarioTodosLosDias('12:00', '22:00') as any;
  const mensajeBienvenida = '¡Hola! Bienvenido a Pizzería Demo 🍕 ¿Qué se te antoja hoy?';

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'pizzeria-demo' },
    update: { horarioAtencion, mensajeBienvenida },
    create: {
      slug: 'pizzeria-demo',
      nombre: 'Pizzería Demo',
      horarioAtencion,
      mensajeBienvenida,
      ubicacion: 'Av. Reforma 123, Ciudad de México',
      // Fixed test value — real tenants get a securely random one at
      // register time (see AuthService). Doesn't need that here.
      botApiKey: 'dev-bot-api-key-pizzeria-demo-0001',
      users: {
        create: {
          nombre: 'Dueño Demo',
          email: 'demo@aelika.com',
          passwordHash: duenoPasswordHash,
          rol: Role.DUENO,
        },
      },
    },
  });

  // Cuentas adicionales para probar RolesGuard sin tener que darlas de alta a
  // mano desde /dashboard/equipo en cada ambiente nuevo.
  const equipo = [
    { nombre: 'Gerente Demo', email: 'gerente@aelika.com', password: 'gerente1234', rol: Role.GERENTE },
    { nombre: 'Operador Demo', email: 'operador@aelika.com', password: 'operador1234', rol: Role.OPERADOR },
  ];

  for (const miembro of equipo) {
    const passwordHash = await bcrypt.hash(miembro.password, 10);
    await prisma.user.upsert({
      where: { email: miembro.email },
      update: {},
      create: {
        tenantId: tenant.id,
        nombre: miembro.nombre,
        email: miembro.email,
        passwordHash,
        rol: miembro.rol,
      },
    });
  }

  // Catálogo mínimo para que las promociones de ejemplo tengan algo a qué apuntar.
  // Un producto solo puede estar en UNA promoción activa a la vez, así que el
  // descuento y el combo apuntan a productos distintos (refresco vs. pizzas).
  const pizzas = await ensureCategory(tenant.id, 'Pizzas', 0);
  const hawaiana = await ensureProduct(tenant.id, pizzas.id, 'Pizza Hawaiana', 149.9);
  const pepperoni = await ensureProduct(tenant.id, pizzas.id, 'Pizza Pepperoni', 129.9);

  const bebidas = await ensureCategory(tenant.id, 'Bebidas', 1);
  const refresco = await ensureProduct(tenant.id, bebidas.id, 'Refresco de Cola', 35);

  await ensurePromotion(tenant.id, PromotionTipo.DESCUENTO_PRODUCTO, {
    productId: refresco.id,
    tipoDescuento: 'porcentaje',
    valor: 15,
  });

  await ensurePromotion(tenant.id, PromotionTipo.COMBO, {
    productIds: [hawaiana.id, pepperoni.id],
    precioCombo: 220,
  });

  // Pedidos de ejemplo en distintos estatus, para ver /dashboard/pedidos con
  // variedad sin tener que pasar por el checkout público a mano.
  //
  // clienteNombre usa nombres reales, no placeholders tipo "Cliente
  // Pendiente" — un nombre que describe el estatus inicial del pedido queda
  // obsoleto en cuanto alguien avanza ese pedido a mano (como pasó aquí:
  // ver CLAUDE.md), y termina pareciendo un bug de "se imprimió el estatus
  // en vez del nombre" cuando en realidad es solo un nombre de prueba
  // desactualizado.
  await ensureOrder(tenant.id, '1', {
    clienteNombre: 'Ana Torres',
    clienteTelefono: '5511112222',
    estadoPedido: EstadoPedido.PENDIENTE_CONFIRMACION,
    horaRecogidaTipo: HoraRecogidaTipo.LO_ANTES_POSIBLE,
    items: [{ productId: refresco.id, nombreProducto: refresco.nombre, precioUnitario: 35, cantidad: 1 }],
    descuentoTotal: 5.25,
    notasDescuento: 'Refresco de Cola x1 (-15%)',
  });

  await ensureOrder(tenant.id, '2', {
    clienteNombre: 'Carlos Ramírez',
    clienteTelefono: '5522223333',
    estadoPedido: EstadoPedido.CONFIRMADO_SURTIENDO,
    horaRecogidaTipo: HoraRecogidaTipo.HORA_ESPECIFICA,
    horaRecogida: '18:00',
    notas: 'Sin cebolla en la Hawaiana',
    items: [
      { productId: hawaiana.id, nombreProducto: hawaiana.nombre, precioUnitario: 149.9, cantidad: 1 },
      { productId: pepperoni.id, nombreProducto: pepperoni.nombre, precioUnitario: 129.9, cantidad: 1 },
    ],
    descuentoTotal: 59.4,
    notasDescuento: 'Combo Pizza Hawaiana + Pizza Pepperoni x1',
  });

  await ensureOrder(tenant.id, '3', {
    clienteNombre: 'Lucía Fernández',
    clienteTelefono: '5533334444',
    estadoPedido: EstadoPedido.DESPACHADO,
    horaRecogidaTipo: HoraRecogidaTipo.LO_ANTES_POSIBLE,
    items: [{ productId: pepperoni.id, nombreProducto: pepperoni.nombre, precioUnitario: 129.9, cantidad: 2 }],
    descuentoTotal: 0,
  });

  console.log(`Seed listo: tenant "${tenant.slug}"`);
  console.log('  demo@aelika.com / demo1234 (DUENO)');
  console.log('  gerente@aelika.com / gerente1234 (GERENTE)');
  console.log('  operador@aelika.com / operador1234 (OPERADOR)');
  console.log('  Categorías "Pizzas" y "Bebidas" con 3 productos y 2 promociones de ejemplo');
  console.log('  3 pedidos de ejemplo: #1 pendiente, #2 surtiendo, #3 despachado');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
