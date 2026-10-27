/**
 * Migración de datos de la Configuración de pagos, Fase 0 (modalidades de cobro B2B).
 *
 * Por cada negocio de mayoreo (RETAIL_B2B):
 *   1. `Tenant.modalidadesCobroB2b` queda con activa SOLO la modalidad de su `pedidoB2bModoCobro` actual. Solo se toca
 *      si sigue en el default de la columna (["AL_FINAL"]) y el modo actual es AL_INICIO (único caso que cambia); un
 *      negocio ya configurado desde Ajustes → Pagos nunca se pisa.
 *   2. Cada cliente B2B con `modalidadPago = NULL` (activos y de baja) recibe la modalidad vigente de su negocio
 *      (`pedidoB2bModoCobro`): exactamente lo que hoy resuelve "Igual que el negocio".
 *   3. Los clientes con modalidad explícita NO se tocan, aunque quede inactiva en su negocio: se reportan aparte.
 *   4. Los pedidos (`detalles_b2b.modoCobro`) no se tocan; el script lo verifica (cuenta y huella antes == después).
 *
 * Uso (ver scripts/modalidades-cobro/README.md para Railway):
 *   node dist/src/scripts/modalidades-cobro-b2b.js [--tenant <slug>]                  # PRUEBA EN SECO (default)
 *   node dist/src/scripts/modalidades-cobro-b2b.js [--tenant <slug>] --aplicar        # escribe (1 transacción)
 *   node dist/src/scripts/modalidades-cobro-b2b.js --revert <archivo> [--forzar]      # restaura los valores previos
 *   --proyecto-esperado <nombre>  guarda: aborta ANTES de conectarse si RAILWAY_PROJECT_NAME no coincide
 *                                 (obligatorio cuando corre dentro de Railway).
 *
 * La prueba en seco hace el trabajo REAL dentro de una transacción y la deshace al final, así el "después" que reporta
 * es el que dejaría --aplicar. Salida: STDOUT = NDJSON (marcado "_":"modalidades-cobro-b2b"; es el respaldo que lee
 * --revert), STDERR = resumen legible sin datos personales (ids truncados a 8).
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ClienteCanal,
  PedidoB2bModoCobro,
  Prisma,
  PrismaClient,
  TipoStorefront,
} from '../../generated/prisma/client';
import {
  MODALIDADES_POR_DEFECTO,
  normalizarModalidades,
} from '../common/modalidades-cobro';

const MARCA = 'modalidades-cobro-b2b';
const TX_OPTS = { timeout: 10 * 60_000, maxWait: 30_000 };

type Tx = Prisma.TransactionClient;
type Modalidad = PedidoB2bModoCobro;
const CLAVES = ['AL_FINAL', 'AL_INICIO', 'NULL'] as const;
type Clave = (typeof CLAVES)[number];

interface CambioTenant {
  tipo: 'tenant';
  tenantId: string;
  slug: string;
  antes: string[];
  despues: string[];
}
interface CambioCliente {
  tipo: 'cliente';
  clienteId: string;
  tenantId: string;
  baja: boolean;
  antes: null;
  despues: Modalidad;
  updatedAtAntes: string;
}
type Cambio = CambioTenant | CambioCliente;

interface FotoTenant {
  tenantId: string;
  slug: string;
  modoCobroActual: Modalidad;
  activas: Modalidad[];
  clientes: Record<'activos' | 'baja', Record<Clave, number>>;
  /** Clientes (activos y de baja) con una modalidad explícita que el negocio no tiene activa. */
  clientesConModalidadInactiva: number;
  pedidos: {
    total: number;
    porModoCobro: Record<string, number>;
    huella: string;
  };
}

const out = (o: Record<string, unknown>) =>
  process.stdout.write(JSON.stringify({ ...o, _: MARCA, v: 1 }) + '\n');
const log = (m = '') => process.stderr.write(m + '\n');
const corto = (id: string) => id.slice(0, 8);
const iso = (d: Date) => d.toISOString();
const mismas = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

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

/** Guarda de entorno: antes de abrir ninguna conexión (mismo patrón que corregir-contadores). */
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
  log(
    `guarda OK: proyecto "${real ?? '(local)'}", entorno "${process.env.RAILWAY_ENVIRONMENT_NAME ?? '(local)'}", dominio "${process.env.RAILWAY_PUBLIC_DOMAIN ?? '?'}"`,
  );
  return {
    proyecto: real ?? 'local',
    entorno: process.env.RAILWAY_ENVIRONMENT_NAME ?? 'local',
  };
}

class Deshacer extends Error {
  constructor(readonly resultado: Resultado) {
    super('rollback de la prueba en seco');
  }
}

interface Resultado {
  antes: FotoTenant[];
  despues: FotoTenant[];
  cambios: Cambio[];
  /** Negocios que ya estaban configurados y no se pisaron. */
  noTocados: { tenantId: string; slug: string; activas: string[] }[];
}

const cero = (): Record<Clave, number> => ({
  AL_FINAL: 0,
  AL_INICIO: 0,
  NULL: 0,
});

async function fotografiar(tx: Tx, tenantIds: string[]): Promise<FotoTenant[]> {
  const tenants = await tx.tenant.findMany({
    where: { id: { in: tenantIds } },
    orderBy: { slug: 'asc' },
    select: {
      id: true,
      slug: true,
      pedidoB2bModoCobro: true,
      modalidadesCobroB2b: true,
    },
  });
  const fotos: FotoTenant[] = [];
  for (const t of tenants) {
    const activas = normalizarModalidades(t.modalidadesCobroB2b);
    const clientes = await tx.cliente.findMany({
      where: { tenantId: t.id, canal: ClienteCanal.B2B },
      select: { modalidadPago: true, bajaAt: true },
    });
    const conteo = { activos: cero(), baja: cero() };
    let inactivas = 0;
    for (const c of clientes) {
      const grupo = c.bajaAt ? conteo.baja : conteo.activos;
      grupo[(c.modalidadPago ?? 'NULL') as Clave]++;
      if (c.modalidadPago && !activas.includes(c.modalidadPago)) inactivas++;
    }
    const detalles = await tx.detalleB2B.findMany({
      where: { tenantId: t.id },
      orderBy: { id: 'asc' },
      select: { id: true, modoCobro: true },
    });
    const porModoCobro: Record<string, number> = {};
    for (const d of detalles)
      porModoCobro[d.modoCobro] = (porModoCobro[d.modoCobro] ?? 0) + 1;
    const huella = createHash('sha256')
      .update(detalles.map((d) => `${d.id}:${d.modoCobro}`).join('|'))
      .digest('hex')
      .slice(0, 16);
    fotos.push({
      tenantId: t.id,
      slug: t.slug,
      modoCobroActual: t.pedidoB2bModoCobro,
      activas,
      clientes: conteo,
      clientesConModalidadInactiva: inactivas,
      pedidos: { total: detalles.length, porModoCobro, huella },
    });
  }
  return fotos;
}

async function negociosEnAlcance(prisma: PrismaClient, ref?: string) {
  const where: Prisma.TenantWhereInput = {
    tipoStorefront: TipoStorefront.RETAIL_B2B,
    ...(ref ? { OR: [{ slug: ref }, { id: ref }] } : {}),
  };
  const t = await prisma.tenant.findMany({ where, select: { id: true } });
  if (ref && t.length === 0)
    throw new Error(`Negocio de mayoreo no encontrado: ${ref}`);
  return t.map((x) => x.id);
}

/** Hace el trabajo real. Con `aplicar = false` la transacción se deshace al final (el "después" es el real). */
async function ejecutar(
  prisma: PrismaClient,
  tenantIds: string[],
  aplicar: boolean,
): Promise<Resultado> {
  const correr = () =>
    prisma.$transaction(async (tx) => {
      const antes = await fotografiar(tx, tenantIds);
      const cambios: Cambio[] = [];
      const noTocados: Resultado['noTocados'] = [];

      for (const f of antes) {
        // 1) Modalidades activas del negocio.
        const porDefecto = mismas(f.activas, MODALIDADES_POR_DEFECTO);
        if (f.modoCobroActual === PedidoB2bModoCobro.AL_INICIO && porDefecto) {
          await tx.tenant.update({
            where: { id: f.tenantId },
            data: { modalidadesCobroB2b: [PedidoB2bModoCobro.AL_INICIO] },
          });
          cambios.push({
            tipo: 'tenant',
            tenantId: f.tenantId,
            slug: f.slug,
            antes: f.activas,
            despues: [PedidoB2bModoCobro.AL_INICIO],
          });
        } else if (!mismas(f.activas, [f.modoCobroActual])) {
          // Ya configurado desde Ajustes → Pagos (o ya migrado con otra combinación): no se pisa.
          noTocados.push({
            tenantId: f.tenantId,
            slug: f.slug,
            activas: f.activas,
          });
        }

        // 2) Clientes con NULL (activos y de baja) → la modalidad vigente del negocio.
        const sinModalidad = await tx.cliente.findMany({
          where: {
            tenantId: f.tenantId,
            canal: ClienteCanal.B2B,
            modalidadPago: null,
          },
          orderBy: { id: 'asc' },
          select: { id: true, bajaAt: true, updatedAt: true },
        });
        for (const c of sinModalidad) {
          await tx.cliente.update({
            where: { id: c.id },
            data: { modalidadPago: f.modoCobroActual },
          });
          cambios.push({
            tipo: 'cliente',
            clienteId: c.id,
            tenantId: f.tenantId,
            baja: c.bajaAt !== null,
            antes: null,
            despues: f.modoCobroActual,
            updatedAtAntes: iso(c.updatedAt),
          });
        }
      }

      const despues = await fotografiar(tx, tenantIds);

      // Verificaciones: si algo no cuadra, rollback y error (también en --aplicar).
      for (let i = 0; i < antes.length; i++) {
        const a = antes[i];
        const d = despues[i];
        if (
          d.pedidos.total !== a.pedidos.total ||
          d.pedidos.huella !== a.pedidos.huella
        )
          throw new Error(
            `Verificación fallida: los pedidos de ${a.slug} cambiaron (modoCobro). Rollback.`,
          );
        const nulos = d.clientes.activos.NULL + d.clientes.baja.NULL;
        if (nulos > 0)
          throw new Error(
            `Verificación fallida: ${a.slug} aún tiene ${nulos} cliente(s) sin modalidad. Rollback.`,
          );
        if (d.activas.length === 0)
          throw new Error(
            `Verificación fallida: ${a.slug} quedó sin modalidades activas. Rollback.`,
          );
      }

      const r: Resultado = { antes, despues, cambios, noTocados };
      if (!aplicar) throw new Deshacer(r);
      return r;
    }, TX_OPTS);

  try {
    return await correr();
  } catch (e) {
    if (e instanceof Deshacer) return e.resultado;
    throw e;
  }
}

function lineaConteo(c: FotoTenant['clientes']) {
  const f = (g: Record<Clave, number>) =>
    `AL_FINAL ${g.AL_FINAL} · AL_INICIO ${g.AL_INICIO} · NULL ${g.NULL}`;
  return `activos [${f(c.activos)}] · de baja [${f(c.baja)}]`;
}

function resumen(modo: string, r: Resultado) {
  log('');
  log(`=== ${modo} ===`);
  log(`Negocios de mayoreo revisados: ${r.antes.length}`);
  for (let i = 0; i < r.antes.length; i++) {
    const a = r.antes[i];
    const d = r.despues[i];
    log(
      `- ${a.slug} (${corto(a.tenantId)}) · modo actual del negocio: ${a.modoCobroActual}`,
    );
    log(
      `    modalidades activas: [${a.activas.join(', ')}] → [${d.activas.join(', ')}]`,
    );
    log(`    clientes ANTES:   ${lineaConteo(a.clientes)}`);
    log(`    clientes DESPUÉS: ${lineaConteo(d.clientes)}`);
    log(
      `    clientes con modalidad inactiva (no tocados): ${a.clientesConModalidadInactiva} → ${d.clientesConModalidadInactiva}`,
    );
    log(
      `    pedidos: ${a.pedidos.total} → ${d.pedidos.total} · por modoCobro ${JSON.stringify(a.pedidos.porModoCobro)} → ${JSON.stringify(d.pedidos.porModoCobro)} · huella ${a.pedidos.huella} ${a.pedidos.huella === d.pedidos.huella ? '== idéntica' : '!= DISTINTA'}`,
    );
  }
  const cT = r.cambios.filter(
    (c): c is CambioTenant => c.tipo === 'tenant',
  ).length;
  const cC = r.cambios.filter((c): c is CambioCliente => c.tipo === 'cliente');
  log('');
  log(`Negocios cuya configuración cambia: ${cT}`);
  log(
    `Clientes que reciben modalidad: ${cC.length} (de baja: ${cC.filter((c) => c.baja).length})`,
  );
  if (r.noTocados.length > 0) {
    log(
      `Negocios ya configurados (no se pisaron): ${r.noTocados.map((n) => `${n.slug} [${n.activas.join(', ')}]`).join('; ')}`,
    );
  }
  const inactivos = r.despues.filter((d) => d.clientesConModalidadInactiva > 0);
  if (inactivos.length > 0) {
    log(
      'Clientes con modalidad explícita INACTIVA en su negocio (se conservan; la ficha los avisará):',
    );
    for (const d of inactivos)
      log(`  - ${d.slug}: ${d.clientesConModalidadInactiva}`);
  }
}

function emitir(
  modo: string,
  meta: Record<string, unknown>,
  tenant: string | undefined,
  r: Resultado,
) {
  out({
    tipo: 'cabecera',
    modo,
    generado: new Date().toISOString(),
    tenant: tenant ?? 'todos',
    negocios: r.antes.length,
    cambios: r.cambios.length,
    ...meta,
  });
  out({ tipo: 'antes', negocios: r.antes });
  out({ tipo: 'despues', negocios: r.despues });
  for (const c of r.cambios) out({ ...c });
  out({ tipo: 'fin', cambios: r.cambios.length });
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
      if (o.tipo === 'tenant' || o.tipo === 'cliente') cambios.push(o);
      if (o.tipo === 'fin') hayFin = true;
    } catch {
      /* línea que no es de este script */
    }
  }
  if (!hayFin)
    throw new Error(
      `El archivo ${ruta} no trae la línea final: salida incompleta, no se revierte.`,
    );
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
      if (c.tipo === 'cliente') {
        const actual = await tx.cliente.findUnique({
          where: { id: c.clienteId },
        });
        if (!actual)
          desviados.push(`cliente ${corto(c.clienteId)} (ya no existe)`);
        else if (actual.modalidadPago !== c.despues)
          desviados.push(
            `cliente ${corto(c.clienteId)} (su modalidad cambió después)`,
          );
      } else {
        const actual = await tx.tenant.findUnique({
          where: { id: c.tenantId },
        });
        if (!actual) desviados.push(`negocio ${c.slug} (ya no existe)`);
        else if (
          !mismas(normalizarModalidades(actual.modalidadesCobroB2b), c.despues)
        )
          desviados.push(
            `negocio ${c.slug} (sus modalidades cambiaron después)`,
          );
      }
    }
    if (desviados.length > 0 && !forzar)
      throw new Error(
        `${desviados.length} registro(s) ya no están como los dejó el script: ${desviados.join(', ')}. Usa --forzar para revertirlos igual.`,
      );
    for (const c of cambios) {
      if (c.tipo === 'cliente') {
        await tx.cliente.updateMany({
          where: { id: c.clienteId },
          data: { modalidadPago: null, updatedAt: new Date(c.updatedAtAntes) },
        });
      } else {
        await tx.tenant.updateMany({
          where: { id: c.tenantId },
          data: { modalidadesCobroB2b: c.antes },
        });
      }
    }
    for (const c of cambios) {
      if (c.tipo !== 'cliente') continue;
      const r = await tx.cliente.findUnique({ where: { id: c.clienteId } });
      if (
        r &&
        (r.modalidadPago !== null || iso(r.updatedAt) !== c.updatedAtAntes)
      )
        throw new Error(
          `Verificación fallida al revertir el cliente ${corto(c.clienteId)}. Rollback.`,
        );
    }
  }, TX_OPTS);
  log(`Revertidos ${cambios.length} registro(s) a sus valores previos.`);
}

async function main() {
  const args = argumentos();
  const meta = guarda(args.proyectoEsperado);
  if (args.revert && args.aplicar)
    throw new Error('--revert y --aplicar son excluyentes.');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    if (args.revert) {
      await revertir(prisma, args.revert, args.forzar);
      return;
    }
    const ids = await negociosEnAlcance(prisma, args.tenant);
    const r = await ejecutar(prisma, ids, args.aplicar);
    emitir(args.aplicar ? 'aplicar' : 'prueba-en-seco', meta, args.tenant, r);
    resumen(
      args.aplicar
        ? 'APLICADO (una transacción, verificado)'
        : 'PRUEBA EN SECO (se hizo y se deshizo; no se escribió nada)',
      r,
    );
    if (!args.aplicar)
      log(
        'Guarda el STDOUT en un archivo local: es el respaldo para --revert.',
      );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  log(`ERROR: ${(e as Error).message}`);
  process.exit(1);
});
