/**
 * Corrección de contadores de Cliente (Pedidos TARJETA no pagados, Parte A3).
 *
 * Recalcula `totalPedidos` / `primerPedidoAt` / `ultimoPedidoAt` de cada Cliente con la MISMA
 * lógica que usa la app (`calcularContadoresCliente` / `recalcularContadoresCliente`, ver
 * clientes/cliente-contadores.ts): B2C cuenta Order PAGADO, B2B cuenta PedidoB2b no cancelado,
 * fechas = createdAt del pedido, sin pedidos = fecha de alta.
 *
 * Uso (ver scripts/contadores/README.md para Railway):
 *   node dist/src/scripts/corregir-contadores.js [--tenant <slug>]                       # DRY-RUN (default)
 *   node dist/src/scripts/corregir-contadores.js [--tenant <slug>] --aplicar             # escribe (1 transacción)
 *   node dist/src/scripts/corregir-contadores.js --revert <archivo> [--forzar]           # restaura los valores previos
 *   --proyecto-esperado <nombre>  guarda: aborta ANTES de conectarse si RAILWAY_PROJECT_NAME no coincide
 *                                 (obligatorio cuando corre dentro de Railway).
 *
 * Salida: STDOUT = NDJSON (una línea JSON por registro, marcadas con "_":"corregir-contadores") —
 * es lo que se guarda en un archivo local y lo que lee --revert. STDERR = resumen legible, sin
 * datos personales (ids truncados a 8). El dry-run no escribe nada (transacción de solo lectura).
 */
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import {
  calcularContadoresCliente,
  recalcularContadoresCliente,
  type ClienteContadoresDb,
  type ContadoresCliente,
} from '../clientes/cliente-contadores';

const MARCA = 'corregir-contadores';
const TX_OPTS = { timeout: 10 * 60_000, maxWait: 30_000 };

type Valores = { totalPedidos: number; primerPedidoAt: string; ultimoPedidoAt: string; updatedAt: string };
type Cambio = { _: typeof MARCA; v: 1; tipo: 'cambio'; clienteId: string; tenantId: string; canal: string; lealtad: boolean; antes: Valores; despues: Valores };

const out = (o: Record<string, unknown>) => process.stdout.write(JSON.stringify({ ...o, _: MARCA, v: 1 }) + '\n');
const log = (m = '') => process.stderr.write(m + '\n');
const corto = (id: string) => id.slice(0, 8);
const iso = (d: Date) => d.toISOString();
const iguales = (a: ContadoresCliente, b: ContadoresCliente) =>
  a.totalPedidos === b.totalPedidos &&
  a.primerPedidoAt.getTime() === b.primerPedidoAt.getTime() &&
  a.ultimoPedidoAt.getTime() === b.ultimoPedidoAt.getTime();

function argumentos() {
  const a = process.argv.slice(2);
  const val = (n: string) => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined);
  return {
    aplicar: a.includes('--aplicar'),
    forzar: a.includes('--forzar'),
    revert: val('--revert'),
    tenant: val('--tenant'),
    proyectoEsperado: val('--proyecto-esperado'),
  };
}

/** Guarda de entorno: antes de abrir ninguna conexión. */
function guarda(proyectoEsperado?: string) {
  const real = process.env.RAILWAY_PROJECT_NAME;
  if (real) {
    if (!proyectoEsperado) throw new Error(`Corre dentro de Railway (proyecto "${real}"): pasa --proyecto-esperado <nombre>.`);
    if (real !== proyectoEsperado) throw new Error(`GUARDA: el contenedor es "${real}" pero se esperaba "${proyectoEsperado}". Abortado sin conectar.`);
  } else if (proyectoEsperado) {
    throw new Error(`GUARDA: se pidió "${proyectoEsperado}" pero no es un contenedor de Railway. Abortado sin conectar.`);
  }
  log(`guarda OK: proyecto "${real ?? '(local)'}", entorno "${process.env.RAILWAY_ENVIRONMENT_NAME ?? '(local)'}", dominio "${process.env.RAILWAY_PUBLIC_DOMAIN ?? '?'}"`);
  return { proyecto: real ?? 'local', entorno: process.env.RAILWAY_ENVIRONMENT_NAME ?? 'local' };
}

const valores = (c: { totalPedidos: number; primerPedidoAt: Date; ultimoPedidoAt: Date; updatedAt: Date }): Valores => ({
  totalPedidos: c.totalPedidos,
  primerPedidoAt: iso(c.primerPedidoAt),
  ultimoPedidoAt: iso(c.ultimoPedidoAt),
  updatedAt: iso(c.updatedAt),
});

async function tenantId(prisma: PrismaClient, ref?: string): Promise<string | undefined> {
  if (!ref) return undefined;
  const t = await prisma.tenant.findFirst({ where: { OR: [{ slug: ref }, { id: ref }] }, select: { id: true } });
  if (!t) throw new Error(`Tenant no encontrado: ${ref}`);
  return t.id;
}

type Fila = { id: string; tenantId: string; canal: string; totalPedidos: number; primerPedidoAt: Date; ultimoPedidoAt: Date; updatedAt: Date; loyaltyCard: { id: string } | null };

const leerClientes = (db: ClienteContadoresDb, tenant?: string): Promise<Fila[]> =>
  db.cliente.findMany({
    where: tenant ? { tenantId: tenant } : {},
    orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, tenantId: true, canal: true, totalPedidos: true, primerPedidoAt: true, ultimoPedidoAt: true, updatedAt: true, loyaltyCard: { select: { id: true } } },
  }) as Promise<Fila[]>;

/** Clientes cuyos contadores actuales difieren de lo que calcula la función (lectura pura). */
async function detectar(db: ClienteContadoresDb, tenant?: string) {
  const clientes = await leerClientes(db, tenant);
  const cambian: { fila: Fila; nuevo: ContadoresCliente }[] = [];
  for (const fila of clientes) {
    const nuevo = await calcularContadoresCliente(db, fila.id);
    if (nuevo && !iguales(fila, nuevo)) cambian.push({ fila, nuevo });
  }
  return { total: clientes.length, cambian };
}

function resumen(modo: string, total: number, cambios: Cambio[]) {
  log('');
  log(`=== ${modo} ===`);
  log(`Clientes revisados: ${total}`);
  log(`Clientes que cambian: ${cambios.length}`);
  const porCanal: Record<string, number> = {};
  let bajan = 0;
  let suben = 0;
  for (const c of cambios) {
    porCanal[c.canal] = (porCanal[c.canal] ?? 0) + 1;
    if (c.despues.totalPedidos < c.antes.totalPedidos) bajan++;
    if (c.despues.totalPedidos > c.antes.totalPedidos) suben++;
  }
  log(`  por canal: ${JSON.stringify(porCanal)} · totalPedidos baja: ${bajan} · sube: ${suben} · solo fechas: ${cambios.length - bajan - suben}`);
  const totales = cambios.reduce((a, c) => ({ antes: a.antes + c.antes.totalPedidos, despues: a.despues + c.despues.totalPedidos }), { antes: 0, despues: 0 });
  log(`  Σ totalPedidos de los que cambian: ${totales.antes} → ${totales.despues}`);
  for (const c of cambios) {
    log(`  ${corto(c.clienteId)} ${c.canal} total ${c.antes.totalPedidos}→${c.despues.totalPedidos}`);
  }
  const lealtad = cambios.filter((c) => c.lealtad && c.antes.primerPedidoAt !== c.despues.primerPedidoAt);
  log('');
  log(`Clientes de Lealtad cuyo primerPedidoAt cambia: ${lealtad.length}`);
  for (const c of lealtad) log(`  ${corto(c.clienteId)} primerPedidoAt ${c.antes.primerPedidoAt} → ${c.despues.primerPedidoAt} (total ${c.antes.totalPedidos}→${c.despues.totalPedidos})`);
  log('');
}

async function dryRun(prisma: PrismaClient, tenant?: string, meta: Record<string, unknown> = {}) {
  // Transacción de SOLO LECTURA: si algo intentara escribir, Postgres lo rechaza.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const db = tx as unknown as ClienteContadoresDb;
    const { total, cambian } = await detectar(db, tenant);
    const cambios: Cambio[] = cambian.map(({ fila, nuevo }) => ({
      _: MARCA, v: 1, tipo: 'cambio', clienteId: fila.id, tenantId: fila.tenantId, canal: fila.canal, lealtad: !!fila.loyaltyCard,
      antes: valores(fila),
      despues: { ...valores({ ...nuevo, updatedAt: fila.updatedAt }), updatedAt: iso(fila.updatedAt) },
    }));
    return { total, cambios };
  }, TX_OPTS).then((r) => emitir('dry-run', tenant, meta, r));
}

/** Se imprime DESPUÉS de cerrar la transacción: el archivo de salida nunca describe algo que no se confirmó. */
function emitir(modo: string, tenant: string | undefined, meta: Record<string, unknown>, r: { total: number; cambios: Cambio[] }) {
  out({ tipo: 'cabecera', modo, generado: new Date().toISOString(), tenant: tenant ?? 'todos', totalClientes: r.total, cambian: r.cambios.length, ...meta });
  for (const c of r.cambios) out({ ...c });
  out({ tipo: 'fin', cambian: r.cambios.length });
  return r;
}

async function aplicar(prisma: PrismaClient, tenant?: string, meta: Record<string, unknown> = {}) {
  return prisma.$transaction(async (tx) => {
    const db = tx as unknown as ClienteContadoresDb;
    const { total, cambian } = await detectar(db, tenant);
    const cambios: Cambio[] = [];
    for (const { fila, nuevo } of cambian) {
      await recalcularContadoresCliente(db, fila.id); // la MISMA función que usa la app
      const despues = await tx.cliente.findUniqueOrThrow({ where: { id: fila.id } });
      // Verificación por cliente: lo escrito == lo que calcula la función.
      if (!iguales(despues, nuevo)) throw new Error(`Verificación fallida para cliente ${corto(fila.id)}: lo escrito no coincide con el cálculo.`);
      cambios.push({ _: MARCA, v: 1, tipo: 'cambio', clienteId: fila.id, tenantId: fila.tenantId, canal: fila.canal, lealtad: !!fila.loyaltyCard, antes: valores(fila), despues: valores(despues) });
    }
    // Verificación global: TODOS los clientes del alcance quedan iguales a lo que calcula la función.
    const restantes = await detectar(db, tenant);
    if (restantes.cambian.length > 0) throw new Error(`Verificación fallida: ${restantes.cambian.length} cliente(s) no coinciden tras aplicar. Rollback.`);
    return { total, cambios };
  }, TX_OPTS).then((r) => emitir('aplicar', tenant, meta, r));
}

function leerArchivo(ruta: string): Cambio[] {
  const cambios: Cambio[] = [];
  let hayFin = false;
  for (const linea of readFileSync(ruta, 'utf8').split('\n')) {
    const t = linea.trim();
    if (!t.startsWith('{')) continue; // ruido (avisos de la CLI, etc.)
    try {
      const o = JSON.parse(t);
      if (o._ !== MARCA) continue;
      if (o.tipo === 'cambio') cambios.push(o);
      if (o.tipo === 'fin') hayFin = true;
    } catch {
      /* línea que no es de este script */
    }
  }
  if (!hayFin) throw new Error(`El archivo ${ruta} no trae la línea final: salida incompleta, no se revierte.`);
  return cambios;
}

async function revertir(prisma: PrismaClient, ruta: string, forzar: boolean) {
  const cambios = leerArchivo(ruta);
  if (cambios.length === 0) {
    log('El archivo no trae cambios: nada que revertir.');
    return;
  }
  await prisma.$transaction(async (tx) => {
    const desviados: string[] = [];
    for (const c of cambios) {
      const actual = await tx.cliente.findUnique({ where: { id: c.clienteId } });
      if (!actual) {
        desviados.push(`${corto(c.clienteId)} (ya no existe)`);
        continue;
      }
      // Solo se revierte lo que sigue como lo dejó el script; si cambió después (pedido nuevo, etc.), se avisa.
      if (actual.totalPedidos !== c.despues.totalPedidos || iso(actual.primerPedidoAt) !== c.despues.primerPedidoAt || iso(actual.ultimoPedidoAt) !== c.despues.ultimoPedidoAt) {
        desviados.push(`${corto(c.clienteId)} (cambió después de la corrección)`);
      }
    }
    if (desviados.length > 0 && !forzar) {
      throw new Error(`${desviados.length} cliente(s) ya no están como los dejó la corrección: ${desviados.join(', ')}. Usa --forzar para revertirlos igual.`);
    }
    for (const c of cambios) {
      await tx.cliente.updateMany({
        where: { id: c.clienteId },
        data: {
          totalPedidos: c.antes.totalPedidos,
          primerPedidoAt: new Date(c.antes.primerPedidoAt),
          ultimoPedidoAt: new Date(c.antes.ultimoPedidoAt),
          updatedAt: new Date(c.antes.updatedAt), // restaura también updatedAt: el valor previo exacto
        },
      });
    }
    // Verificación: cada cliente quedó exactamente como estaba antes.
    for (const c of cambios) {
      const r = await tx.cliente.findUnique({ where: { id: c.clienteId } });
      if (!r) continue;
      const ok = r.totalPedidos === c.antes.totalPedidos && iso(r.primerPedidoAt) === c.antes.primerPedidoAt && iso(r.ultimoPedidoAt) === c.antes.ultimoPedidoAt && iso(r.updatedAt) === c.antes.updatedAt;
      if (!ok) throw new Error(`Verificación fallida al revertir el cliente ${corto(c.clienteId)}. Rollback.`);
    }
  }, TX_OPTS);
  log(`Revertidos ${cambios.length} cliente(s) a sus valores previos.`);
}

async function main() {
  const args = argumentos();
  const meta = guarda(args.proyectoEsperado);
  if (args.revert && args.aplicar) throw new Error('--revert y --aplicar son excluyentes.');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    if (args.revert) {
      await revertir(prisma, args.revert, args.forzar);
      return;
    }
    const tenant = await tenantId(prisma, args.tenant);
    if (args.aplicar) {
      const r = await aplicar(prisma, tenant, meta);
      resumen('APLICADO (una transacción, verificado)', r.total, r.cambios);
    } else {
      const r = await dryRun(prisma, tenant, meta);
      resumen('DRY-RUN (no se escribió nada)', r.total, r.cambios);
      log('Guarda el STDOUT en un archivo local: es el respaldo para --revert.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  log(`ERROR: ${(e as Error).message}`);
  process.exit(1);
});
