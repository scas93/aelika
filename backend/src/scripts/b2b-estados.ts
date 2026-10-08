/**
 * Migración de datos de B2B al modelo de estados por entrega (núcleo: scripts/b2b-estados/migracion.ts).
 * Idempotente. Cambios (ver el encabezado del núcleo): DESPACHADO → COMPLETADO y, aparte, totales de pedidos cancelados.
 *
 * Uso:
 *   node dist/src/scripts/b2b-estados.js                       # DEFAULT = DRY-RUN: transacción de solo lectura, no escribe nada
 *   node dist/src/scripts/b2b-estados.js --aplicar [--totales-cancelados]   # una transacción, verificada (rollback si algo no coincide)
 *   node dist/src/scripts/b2b-estados.js --revertir <respaldo.ndjson> [--forzar]
 *   --tenant <slug|id>            limita a un tenant
 *   --proyecto-esperado <nombre>  guarda: dentro de Railway es obligatorio y debe coincidir con RAILWAY_PROJECT_NAME.
 *
 * STDOUT = NDJSON (marca "_":"b2b-estados"): en --aplicar incluye un registro `respaldo` por pedido cambiado (guárdalo en un
 * archivo local: es lo que consume --revertir). STDERR = resumen legible sin datos personales.
 */
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import {
  aplicar,
  planificar,
  revertir,
  type Cambio,
} from './b2b-estados/migracion';

const MARCA = 'b2b-estados';
const TX_OPTS = { timeout: 5 * 60_000, maxWait: 30_000 };
const out = (o: Record<string, unknown>) =>
  process.stdout.write(JSON.stringify({ ...o, _: MARCA, v: 1 }) + '\n');
const log = (m = '') => process.stderr.write(m + '\n');

function argumentos() {
  const a = process.argv.slice(2);
  const val = (n: string) => (a.includes(n) ? a[a.indexOf(n) + 1] : undefined);
  return {
    aplicar: a.includes('--aplicar'),
    totalesCancelados: a.includes('--totales-cancelados'),
    revertir: val('--revertir'),
    forzar: a.includes('--forzar'),
    tenant: val('--tenant'),
    proyectoEsperado: val('--proyecto-esperado'),
  };
}

function guarda(proyectoEsperado?: string) {
  const real = process.env.RAILWAY_PROJECT_NAME;
  if (real) {
    if (!proyectoEsperado)
      throw new Error(
        `Corre dentro de Railway (proyecto "${real}"): pasa --proyecto-esperado <nombre>.`,
      );
    if (real !== proyectoEsperado)
      throw new Error(
        `GUARDA: el contenedor es "${real}" pero se esperaba "${proyectoEsperado}". Abortado sin conectar.`,
      );
  } else if (proyectoEsperado) {
    throw new Error(
      `GUARDA: se pidió "${proyectoEsperado}" pero no es un contenedor de Railway. Abortado sin conectar.`,
    );
  }
  const meta = {
    proyecto: real ?? 'local',
    entorno: process.env.RAILWAY_ENVIRONMENT_NAME ?? 'local',
    dominio: process.env.RAILWAY_PUBLIC_DOMAIN ?? '?',
  };
  log(
    `guarda OK: proyecto "${meta.proyecto}", entorno "${meta.entorno}", dominio "${meta.dominio}"`,
  );
  return meta;
}

async function main() {
  const args = argumentos();
  const meta = guarda(args.proyectoEsperado);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    let tenantId: string | undefined;
    if (args.tenant) {
      const t = await prisma.tenant.findFirst({
        where: { OR: [{ slug: args.tenant }, { id: args.tenant }] },
        select: { id: true },
      });
      if (!t) throw new Error(`Tenant no encontrado: ${args.tenant}`);
      tenantId = t.id;
    }

    if (args.revertir) {
      const respaldo = readFileSync(args.revertir, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { _?: string; tipo?: string })
        .filter(
          (r) => r._ === MARCA && r.tipo === 'respaldo',
        ) as unknown as Cambio[];
      const r = await prisma.$transaction(
        (tx) => revertir(tx, respaldo, args.forzar),
        TX_OPTS,
      );
      out({ tipo: 'revertido', ...meta, ...r });
      log(
        `REVERTIDO: ${r.restaurados} pedidos restaurados al estado y totales previos.`,
      );
      return;
    }

    if (!args.aplicar) {
      const plan = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return planificar(tx, { tenantId });
      }, TX_OPTS);
      out({ tipo: 'plan', ...meta, ...plan });
      log('— DRY-RUN (solo lectura; no se escribió nada) —');
      log('Pedidos B2B por (tenant, estado, cancelado):');
      for (const c of plan.porEstado)
        log(
          `  ${c.slug.padEnd(20)} ${String(c.estadoPedido).padEnd(24)} cancelado=${c.cancelado ? 'sí' : 'no'}  ${c.pedidos}`,
        );
      const est = plan.cambios.filter((c) => c.tipoCambio === 'ESTADO');
      const tot = plan.cambios.filter(
        (c) => c.tipoCambio === 'TOTALES_CANCELADO',
      );
      log(`CAMBIOS — estado DESPACHADO → COMPLETADO: ${est.length}`);
      log(
        `CAMBIOS — totales de pedidos cancelados (requiere --totales-cancelados): ${tot.length}`,
      );
      for (const c of tot)
        log(`    ${c.folio}: total ${c.antes.total} → ${c.despues.total}`);
      log(
        `Caso dudoso (DESPACHADO con entregas no ENTREGADA; se dejan COMPLETADO): ${plan.dudosos.length}`,
      );
      for (const d of plan.dudosos)
        log(`    ${d.folio}: ${JSON.stringify(d.entregas)}`);
      log(
        `Cancelados con entregas cerradas (inesperado): ${plan.canceladosConEntregasCerradas.length}`,
      );
      log(
        `Pedidos no cancelados cuyo total guardado difiere del calculado desde las entregas (informativo, no se toca): ${plan.totalesNoCoinciden.length}`,
      );
      for (const d of plan.totalesNoCoinciden)
        log(
          `    ${d.folio}: guardado ${d.guardado} · calculado ${d.calculado}`,
        );
      return;
    }

    // Los registros de respaldo salen ANTES de escribir (si la transacción hace rollback, no se aplicó nada).
    const resultado = await prisma.$transaction(async (tx) => {
      const plan = await planificar(tx, { tenantId });
      const aplicables = plan.cambios.filter(
        (c) => c.tipoCambio === 'ESTADO' || args.totalesCancelados,
      );
      for (const c of aplicables) out({ tipo: 'respaldo', ...c });
      return aplicar(tx, plan, {
        tenantId,
        totalesCancelados: args.totalesCancelados,
      });
    }, TX_OPTS);
    out({ tipo: 'aplicado', ...meta, ...resultado });
    log(
      `APLICADO: ${resultado.estados} pedidos a COMPLETADO, ${resultado.totales} totales de cancelados recalculados. Verificado.`,
    );
    log(
      'Guarda el STDOUT en un archivo local: es el respaldo que consume --revertir.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  log(`ERROR: ${(e as Error).message}`);
  process.exit(1);
});
