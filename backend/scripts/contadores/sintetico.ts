/**
 * Datos sintéticos para probar corregir-contadores.ts en una base LOCAL vacía (migrada).
 * Reproduce el estado ANTERIOR a la Parte A2 (contadores inflados por incrementos sueltos) y algunos
 * clientes que ya están bien. Se niega a correr contra una base que no sea local.
 *
 *   DATABASE_URL=postgresql://.../contadores_prueba npx tsx scripts/contadores/sintetico.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error('Solo bases locales.');
  process.exit(2);
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const d = (s: string) => new Date(`2026-09-${s}:00.000Z`);

async function main() {
  if ((await prisma.tenant.count()) > 0) throw new Error('La base no está vacía: usa una base nueva.');
  const mk = (slug: string) => prisma.tenant.create({ data: { slug, nombre: slug, botApiKey: `k-${slug}` } });
  const A = await mk('sint-a');
  const B = await mk('sint-b');

  let n = 0;
  const cliente = (t: string, canal: 'B2C' | 'B2B', nombre: string, total: number, primer: string, ultimo: string, alta = '01T10:00') =>
    prisma.cliente.create({
      data: { tenantId: t, canal, telefono: `55000000${String(++n).padStart(2, '0')}`, nombre, totalPedidos: total, primerPedidoAt: d(primer), ultimoPedidoAt: d(ultimo), createdAt: d(alta) },
    });
  let folio = 0;
  const order = (t: string, c: { id: string }, mp: 'EFECTIVO' | 'TARJETA', ep: 'PAGADO' | 'PENDIENTE' | 'FALLIDO' | 'REEMBOLSADO', fecha: string) =>
    prisma.order.create({
      data: { tenantId: t, clienteId: c.id, folio: String(++folio), clienteNombre: 'x', clienteTelefono: '0', metodoPago: mp, estadoPago: ep, total: 10, createdAt: d(fecha) },
    });
  const b2b = (t: string, c: { id: string }, cancelado: boolean, fecha: string) =>
    // Etapa 2: un pedido B2B es una Order (tipo B2B); para los contadores solo importan tipo, cancelado y createdAt.
    prisma.order.create({
      data: { tenantId: t, clienteId: c.id, folio: String(++folio), tipo: 'B2B', clienteNombre: 'c', clienteTelefono: '0', metodoPago: null, estadoPago: 'PENDIENTE', total: 10, cancelado, createdAt: d(fecha) },
    });
  const tarjeta = (t: string, c: { id: string }) => prisma.loyaltyCard.create({ data: { tenantId: t, clienteId: c.id, token: `tok-${c.id}` } });

  // 1. Solo un intento TARJETA PENDIENTE: contado de más (1) → 0, fechas a la de alta.
  const c1 = await cliente(A.id, 'B2C', 'c1', 1, '10T12:00', '10T12:00');
  await order(A.id, c1, 'TARJETA', 'PENDIENTE', '10T12:00');
  // 2. PAGADO + PENDIENTE + FALLIDO: 3 → 1, fechas al pedido pagado.
  const c2 = await cliente(A.id, 'B2C', 'c2', 3, '11T09:00', '13T09:00');
  await order(A.id, c2, 'TARJETA', 'PAGADO', '11T09:00');
  await order(A.id, c2, 'TARJETA', 'PENDIENTE', '12T09:00');
  await order(A.id, c2, 'TARJETA', 'FALLIDO', '13T09:00');
  // 3. Solo un REEMBOLSADO: 1 → 0.
  const c3 = await cliente(A.id, 'B2C', 'c3', 1, '14T09:00', '14T09:00');
  await order(A.id, c3, 'TARJETA', 'REEMBOLSADO', '14T09:00');
  // 4. Dos EFECTIVO pagados: ya está bien → sin cambio.
  const c4 = await cliente(A.id, 'B2C', 'c4', 2, '15T09:00', '16T09:00');
  await order(A.id, c4, 'EFECTIVO', 'PAGADO', '15T09:00');
  await order(A.id, c4, 'EFECTIVO', 'PAGADO', '16T09:00');
  // 5. Lealtad sin pedidos: 0 y fechas = alta → sin cambio.
  const c5 = await cliente(A.id, 'B2C', 'c5', 0, '02T10:00', '02T10:00', '02T10:00');
  await tarjeta(A.id, c5);
  // 6. Lealtad que luego pidió (paga): primerPedidoAt se quedó en la alta (bug congelado) → cambia a la fecha del pedido.
  const c6 = await cliente(A.id, 'B2C', 'c6', 1, '03T10:00', '17T09:00', '03T10:00');
  await tarjeta(A.id, c6);
  await order(A.id, c6, 'EFECTIVO', 'PAGADO', '17T09:00');
  // 7. B2B con un pedido vivo y uno cancelado: 2 → 1.
  const c7 = await cliente(A.id, 'B2B', 'c7', 2, '18T09:00', '19T09:00');
  await b2b(A.id, c7, false, '18T09:00');
  await b2b(A.id, c7, true, '19T09:00');
  // 8. B2B solo cancelado: 1 → 0.
  const c8 = await cliente(A.id, 'B2B', 'c8', 1, '20T09:00', '20T09:00');
  await b2b(A.id, c8, true, '20T09:00');
  // 9. B2B vivo, ya correcto → sin cambio.
  const c9 = await cliente(A.id, 'B2B', 'c9', 1, '21T09:00', '21T09:00');
  await b2b(A.id, c9, false, '21T09:00');
  // 10. Otro tenant: intento TARJETA PENDIENTE inflado (para probar --tenant).
  const c10 = await cliente(B.id, 'B2C', 'c10', 1, '22T09:00', '22T09:00');
  await order(B.id, c10, 'TARJETA', 'PENDIENTE', '22T09:00');
  console.log('sintético listo: 10 clientes en 2 tenants (esperado: cambian c1, c2, c3, c6, c7, c8 en sint-a y c10 en sint-b).');
}

main().finally(() => prisma.$disconnect());
