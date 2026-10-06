/**
 * Etapa 2 · migración de pedidos B2B a la orden centralizada (PedidoB2b → Order + DetalleB2B + Entrega + EntregaItem).
 * Núcleo: scripts/etapa2/migracion-b2b.ts. Guía y comandos de Railway: backend/scripts/etapa2/MIGRACION.md.
 *
 * Uso:
 *   node dist/src/scripts/etapa2-b2b.js planificar [--tenant <slug|id>] [--sin-ensayo]   # DEFAULT. Solo lectura + ENSAYO (migra y hace rollback)
 *   node dist/src/scripts/etapa2-b2b.js migrar --aplicar [--tenant …]                    # confirma (una transacción, verificada)
 *   node dist/src/scripts/etapa2-b2b.js auditar [--tenant …]                             # solo lectura: legacy vs nuevo, contadores
 *   node dist/src/scripts/etapa2-b2b.js revertir [--aplicar] [--tenant …]                # reversa: reconstruye PedidoB2b y borra las órdenes B2B
 *   --proyecto-esperado <nombre>   guarda: aborta ANTES de conectarse si RAILWAY_PROJECT_NAME no coincide (obligatorio en Railway).
 *
 * STDOUT = NDJSON (marca "_":"etapa2-b2b"); en `revertir --aplicar` incluye el respaldo de las filas que borra.
 * STDERR = resumen legible, sin datos personales (ids truncados a 8).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { calcularContadoresCliente, type ClienteContadoresDb } from '../clientes/cliente-contadores';
import {
  agregados,
  discrepancias,
  migrar,
  piezasPorFecha,
  planificar,
  respaldoOrdenesB2b,
  revertir,
  SET_MIGRADOS,
  SET_ORDENES_B2B,
  type Tx,
} from './etapa2/migracion-b2b';

const MARCA = 'etapa2-b2b';
const TX_OPTS = { timeout: 10 * 60_000, maxWait: 30_000 };
const out = (o: Record<string, unknown>) => process.stdout.write(JSON.stringify({ ...o, _: MARCA, v: 1 }) + '\n');
const log = (m = '') => process.stderr.write(m + '\n');

class Rollback extends Error {
  constructor(public resultado: unknown) {
    super('rollback intencional (ensayo)');
  }
}

function argumentos() {
  const a = process.argv.slice(2);
  const val = (n: string) => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined);
  const cmd = a[0] && !a[0].startsWith('--') ? a[0] : 'planificar';
  return { cmd, aplicar: a.includes('--aplicar'), sinEnsayo: a.includes('--sin-ensayo'), tenant: val('--tenant'), proyectoEsperado: val('--proyecto-esperado') };
}

function guarda(proyectoEsperado?: string) {
  const real = process.env.RAILWAY_PROJECT_NAME;
  if (real) {
    if (!proyectoEsperado) throw new Error(`Corre dentro de Railway (proyecto "${real}"): pasa --proyecto-esperado <nombre>.`);
    if (real !== proyectoEsperado) throw new Error(`GUARDA: el contenedor es "${real}" pero se esperaba "${proyectoEsperado}". Abortado sin conectar.`);
  } else if (proyectoEsperado) {
    throw new Error(`GUARDA: se pidió "${proyectoEsperado}" pero no es un contenedor de Railway. Abortado sin conectar.`);
  }
  const meta = { proyecto: real ?? 'local', entorno: process.env.RAILWAY_ENVIRONMENT_NAME ?? 'local', dominio: process.env.RAILWAY_PUBLIC_DOMAIN ?? '?' };
  log(`guarda OK: proyecto "${meta.proyecto}", entorno "${meta.entorno}", dominio "${meta.dominio}"`);
  return meta;
}

async function tenantId(prisma: PrismaClient, ref?: string): Promise<string | undefined> {
  if (!ref) return undefined;
  const t = await prisma.tenant.findFirst({ where: { OR: [{ slug: ref }, { id: ref }] }, select: { id: true } });
  if (!t) throw new Error(`Tenant no encontrado: ${ref}`);
  return t.id;
}

function imprimirPlan(p: Awaited<ReturnType<typeof planificar>>) {
  log('— PLAN (solo lectura) —');
  log(`pedidos legacy: ${p.totales.pedidosLegacy} · ya migrados: ${p.totales.migrados} · pendientes: ${p.totales.pendientes}`);
  for (const t of p.tenants) {
    log(`  ${String(t.slug).padEnd(22)} ${t.tipo.padEnd(10)} legacy ${t.pedidos_legacy} · pendientes ${t.pendientes} · órdenes B2C ${t.ordenes_b2c} · órdenes B2B ${t.ordenes_b2b}`);
  }
  const h = p.hallazgos;
  const linea = (nombre: string, lista: any[], extra = '') => log(`  ${lista.length ? '⚠' : '·'} ${nombre}: ${lista.length}${extra}`);
  linea('tenants MIXTOS (con órdenes B2C y pedidos B2B)', h.tenantsMixtos, h.tenantsMixtos.length ? ` → ${h.tenantsMixtos.map((x: any) => x.slug).join(', ')}` : '');
  linea('tenants RETAIL_B2C con pedidos B2B (el guard los bloqueará)', h.tenantsB2cConPedidosB2b, h.tenantsB2cConPedidosB2b.length ? ` → ${h.tenantsB2cConPedidosB2b.map((x: any) => x.slug).join(', ')}` : '');
  linea('productos repetidos en un pedido (se consolidan)', h.productosRepetidos);
  linea('cantidades inconsistentes', h.inconsistenciasCantidades);
  linea('pedidos sin ítems', h.pedidosSinItems);
  linea('días con cantidad ≤ 0', h.diasEnCero);
  linea('clientes que no son canal B2B', h.clientesNoB2b);
  linea('folios no numéricos', h.foliosNoNumericos);
  linea('colisiones de folio con órdenes B2B', h.colisionesDeFolio);
  linea('semana que no es lunes (informativo)', h.semanaNoLunes);
  log(p.bloqueantes.length ? `BLOQUEANTES: ${p.bloqueantes.join('; ')}` : 'Sin bloqueantes.');
}

async function main() {
  const args = argumentos();
  const meta = guarda(args.proyectoEsperado);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const o = { tenantId: await tenantId(prisma, args.tenant) };

    if (args.cmd === 'planificar' || (args.cmd === 'migrar' && !args.aplicar)) {
      const plan = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return planificar(tx, o);
      }, TX_OPTS);
      out({ tipo: 'plan', ...meta, ...plan });
      imprimirPlan(plan);
      if (!args.sinEnsayo && plan.totales.pendientes > 0) {
        if (plan.bloqueantes.length) {
          log('ENSAYO omitido: hay bloqueantes.');
        } else {
          try {
            await prisma.$transaction(async (tx) => {
              throw new Rollback(await migrar(tx, o));
            }, TX_OPTS);
          } catch (e) {
            if (!(e instanceof Rollback)) throw e;
            out({ tipo: 'ensayo', ...(e.resultado as object) });
            const r = e.resultado as Awaited<ReturnType<typeof migrar>>;
            log(`ENSAYO OK (rollback, nada se escribió): ${r.migrados} pedidos → ${r.items} ítems (${r.consolidados} líneas consolidadas), ${r.entregas} entregas, ${r.entregaItems} productos de entrega; verificación sin diferencias.`);
          }
        }
      }
      log('DRY-RUN: no se escribió nada. Revisa los hallazgos y pide el OK antes de --aplicar.');
      return;
    }

    if (args.cmd === 'migrar') {
      const r = await prisma.$transaction((tx) => migrar(tx, o), TX_OPTS);
      out({ tipo: 'migrado', ...meta, ...r });
      log(`APLICADO: ${r.migrados} pedidos → ${r.items} ítems (${r.consolidados} consolidados), ${r.entregas} entregas, ${r.entregaItems} productos de entrega. Verificado.`);
      return;
    }

    if (args.cmd === 'auditar') {
      const res = await prisma.$transaction(async (tx: Tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const set = SET_MIGRADOS(o);
        const dis = await discrepancias(tx, set);
        const ag = await agregados(tx, set);
        const pf = await piezasPorFecha(tx, set);
        const cl = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT DISTINCT o."clienteId" AS id FROM orders o WHERE o.tipo='B2B' ${o.tenantId ? `AND o."tenantId"='${o.tenantId}'` : ''}`);
        // Paridad de contadores: la fórmula ANTERIOR (PedidoB2b no cancelado) y la NUEVA (Order B2B no cancelada) deben dar lo
        // mismo para cada Cliente B2B. Aparte, el desfase PREVIO entre lo guardado y lo calculado es informativo (lo repara
        // corregir-contadores); la migración no toca los contadores.
        const contadores: string[] = [];
        const desfasePrevio: string[] = [];
        for (const { id } of cl) {
          const esperado = await calcularContadoresCliente(tx as unknown as ClienteContadoresDb, id);
          const [leg] = await tx.$queryRawUnsafe<{ n: number; primero: Date | null; ultimo: Date | null }[]>(
            `SELECT count(*)::int AS n, min("createdAt") AS primero, max("createdAt") AS ultimo FROM pedidos_b2b WHERE "clienteId"='${id}' AND cancelado = false`,
          );
          if (!esperado || esperado.totalPedidos !== leg.n || (leg.n > 0 && (+esperado.primerPedidoAt !== +leg.primero! || +esperado.ultimoPedidoAt !== +leg.ultimo!))) {
            contadores.push(id.slice(0, 8));
          }
          const actual = await tx.cliente.findUnique({ where: { id }, select: { totalPedidos: true, primerPedidoAt: true, ultimoPedidoAt: true } });
          if (!esperado || !actual || esperado.totalPedidos !== actual.totalPedidos || +esperado.primerPedidoAt !== +actual.primerPedidoAt || +esperado.ultimoPedidoAt !== +actual.ultimoPedidoAt) {
            desfasePrevio.push(id.slice(0, 8));
          }
        }
        const [{ n: sinMigrar }] = await tx.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM pedidos_b2b p WHERE NOT EXISTS (SELECT 1 FROM detalles_b2b d WHERE d."legacyPedidoB2bId"=p.id) ${o.tenantId ? `AND p."tenantId"='${o.tenantId}'` : ''}`,
        );
        const [{ n: ordenesB2b }] = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM (${SET_ORDENES_B2B(o)}) s`);
        return { dis, ag, pf, contadores, desfasePrevio, sinMigrar, ordenesB2b };
      }, TX_OPTS);
      const pfMal = res.pf.filter((r) => r.legacy !== r.nuevo);
      out({ tipo: 'auditoria', ...meta, ...res, piezasPorFechaDistintas: pfMal });
      log('— AUDITORÍA legacy ↔ nuevo (pedidos migrados) —');
      for (const l of res.ag.legacy) {
        const n = res.ag.nuevo.find((x: any) => x.slug === l.slug);
        const f = (k: string) => `${l[k]} → ${n?.[k]}${String(l[k]) === String(n?.[k]) ? '' : '  ⚠'}`;
        log(`  ${l.slug}: pedidos ${f('pedidos')} · pend ${f('pendientes')} · conf ${f('confirmados')} · desp ${f('despachados')} · pagados ${f('pagados')} · cancel ${f('cancelados')}`);
        log(`      total ${f('suma_total')} · subtotal ${f('suma_subtotal')} · descuento ${f('suma_descuento')} · piezas ${f('piezas')} · piezas en días ${f('piezas_en_dias')}`);
        log(`      líneas de ítem ${f('lineas_item')} (distinto = productos repetidos consolidados) · folios ${l.folios === n?.folios ? 'idénticos' : 'DISTINTOS ⚠'}`);
      }
      log(`  piezas por fecha: ${res.pf.length} (tenant, fecha) comparadas · distintas: ${pfMal.length}`);
      log(`  pedidos con diferencias (campos, ítems o días): ${res.dis.length}`);
      log(`  contadores de Cliente B2B: paridad fórmula anterior ↔ nueva, diferencias: ${res.contadores.length}`);
      log(`  (informativo) clientes B2B con contador guardado distinto del calculado, desfase PREVIO a la migración: ${res.desfasePrevio.length} → los repara corregir-contadores`);
      log(`  pedidos legacy aún sin migrar: ${res.sinMigrar} · órdenes B2B totales: ${res.ordenesB2b}`);
      const ok = !res.dis.length && !pfMal.length && !res.contadores.length;
      log(ok ? 'AUDITORÍA OK' : 'AUDITORÍA CON DIFERENCIAS ⚠');
      if (!ok) process.exitCode = 3;
      return;
    }

    if (args.cmd === 'revertir') {
      const r = await (async () => {
        try {
          return await prisma.$transaction(async (tx) => {
            for (const fila of await respaldoOrdenesB2b(tx, o)) if (args.aplicar) out({ tipo: 'respaldo', ...fila });
            const res = await revertir(tx, o);
            if (!args.aplicar) throw new Rollback(res);
            return res;
          }, TX_OPTS);
        } catch (e) {
          if (e instanceof Rollback) return e.resultado as Awaited<ReturnType<typeof revertir>>;
          throw e;
        }
      })();
      out({ tipo: args.aplicar ? 'revertido' : 'ensayo-reversa', ...meta, ...r });
      log(`${args.aplicar ? 'REVERTIDO' : 'ENSAYO DE REVERSA (rollback, nada se escribió)'}: ${r.ordenes} órdenes B2B → ${r.creadosEnLegacy} pedidos creados y ${r.actualizadosEnLegacy} actualizados en pedidos_b2b; ${r.clientesRecalculados} clientes recalculados; ${r.eliminadas} órdenes eliminadas.`);
      if (args.aplicar) log('Guarda el STDOUT en un archivo local: es el respaldo de las filas eliminadas.');
      return;
    }

    throw new Error(`Comando desconocido: ${args.cmd}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  log(`ERROR: ${(e as Error).message}`);
  process.exit(1);
});
