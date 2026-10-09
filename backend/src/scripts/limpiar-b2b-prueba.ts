/**
 * Limpieza de los datos B2B DE PRUEBA (clientes B2B, pedidos B2B y sus entregas) para re-sembrarlos con el modelo
 * de clientes B2B por alta (entrega 2a). NO toca B2C (Entredós y demás), catálogos, tenants, usuarios ni
 * los códigos de descuento B2B.
 *
 * Borra, en una sola transacción y en este orden:
 *   1. Order con tipo = B2B  (cascada: detalles_b2b, order_items, entregas, entrega_items, payments, ...)
 *   2. PedidoB2b legado      (cascada: pedido_b2b_items, pedido_b2b_items_dia)
 *   3. Cliente con canal = B2B (cascada: cliente_telefonos, regla_envio_logs, ...)
 *
 * Uso:
 *   npx tsx src/scripts/limpiar-b2b-prueba.ts [--tenant <slug>]            # DRY-RUN (default): solo cuenta
 *   npx tsx src/scripts/limpiar-b2b-prueba.ts [--tenant <slug>] --aplicar  # borra
 *   --proyecto-esperado <nombre>  obligatorio cuando corre dentro de Railway (aborta antes de conectar).
 * Fuera de Railway solo corre contra una base local (localhost/127.0.0.1); para otra base usa Railway + guarda.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

const log = (m = '') => process.stderr.write(m + '\n');
const args = process.argv.slice(2);
const val = (f: string) =>
  args.includes(f) ? args[args.indexOf(f) + 1] : undefined;

function guarda() {
  const real = process.env.RAILWAY_PROJECT_NAME;
  const esperado = val('--proyecto-esperado');
  if (real) {
    if (!esperado)
      throw new Error(
        `Corre dentro de Railway (proyecto "${real}"): pasa --proyecto-esperado <nombre>.`,
      );
    if (esperado !== real)
      throw new Error(
        `Proyecto esperado "${esperado}" ≠ real "${real}". Aborto sin conectar.`,
      );
  } else {
    const host = new URL(
      process.env.DATABASE_URL ?? 'postgresql://x@invalido/x',
    ).hostname;
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
      throw new Error(
        `DATABASE_URL apunta a "${host}", no a una base local. Aborto.`,
      );
    }
  }
  log(
    `guarda OK: proyecto "${real ?? '(local)'}", entorno "${process.env.RAILWAY_ENVIRONMENT_NAME ?? '(local)'}"`,
  );
}

async function main() {
  guarda();
  const aplicar = args.includes('--aplicar');
  const slug = val('--tenant');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  const tenantWhere = slug ? { tenant: { slug } } : {};
  const contar = async (
    db:
      PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
  ) => ({
    'orders (tipo B2B)': await db.order.count({
      where: { tipo: 'B2B', ...tenantWhere },
    }),
    detalles_b2b: await db.detalleB2B.count({ where: tenantWhere }),
    'order_items (de pedidos B2B)': await db.orderItem.count({
      where: { order: { tipo: 'B2B', ...tenantWhere } },
    }),
    entregas: await db.entrega.count({
      where: { order: { tipo: 'B2B', ...tenantWhere } },
    }),
    entrega_items: await db.entregaItem.count({
      where: { entrega: { order: { tipo: 'B2B', ...tenantWhere } } },
    }),
    'pedidos_b2b (legado)': await db.pedidoB2b.count({ where: tenantWhere }),
    'clientes (canal B2B)': await db.cliente.count({
      where: { canal: 'B2B', ...tenantWhere },
    }),
    cliente_telefonos: await db.clienteTelefono.count({
      where: { cliente: { canal: 'B2B', ...tenantWhere } },
    }),
  });

  try {
    const antes = await contar(prisma);
    log(
      `${aplicar ? 'APLICAR' : 'DRY-RUN'}${slug ? ` (tenant ${slug})` : ' (todos los tenants)'} — filas a borrar:`,
    );
    for (const [t, n] of Object.entries(antes)) log(`  ${t.padEnd(32)} ${n}`);
    if (!aplicar)
      return log(
        '\nDry-run: no se escribió nada. Repite con --aplicar para borrar.',
      );

    await prisma.$transaction(
      async (tx) => {
        await tx.order.deleteMany({ where: { tipo: 'B2B', ...tenantWhere } });
        await tx.pedidoB2b.deleteMany({ where: tenantWhere });
        await tx.cliente.deleteMany({
          where: { canal: 'B2B', ...tenantWhere },
        });
        const restantes = await contar(tx);
        if (Object.values(restantes).some((n) => n !== 0)) {
          throw new Error(
            `Verificación fallida, rollback: ${JSON.stringify(restantes)}`,
          );
        }
      },
      { timeout: 5 * 60_000 },
    );
    // Con todos los B2B fuera, la CHECK clientes_identidad_check (NOT VALID desde la migración 2d) ya se puede validar.
    if (!slug) {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "clientes" VALIDATE CONSTRAINT "clientes_identidad_check"',
      );
      log('CHECK clientes_identidad_check validada.');
    } else {
      log(
        'Con --tenant no se valida la CHECK (pueden quedar B2B de otros tenants).',
      );
    }
    log('Listo. Re-siembra con los seeds B2B.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  log(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
