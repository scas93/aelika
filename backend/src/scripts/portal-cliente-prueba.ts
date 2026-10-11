/**
 * Datos de PRUEBA del portal del cliente (Fase 4, 4b): deja un teléfono como principal de UN cliente B2B activo de un
 * negocio, para poder entrar al portal en staging. No toca nada más (ni otros clientes, ni pedidos, ni catálogo).
 *
 * Plan (siempre se imprime primero; sin --aplicar no escribe nada):
 *   - Si hay clientes activos: elige uno (el que ya tenga ese teléfono; si no, --cliente <código>; si no, el primero
 *     por nombre). Si le falta el teléfono se agrega; se marca principal y el principal anterior pasa a no principal
 *     (no se borra ningún teléfono).
 *   - Si NO hay clientes activos: no inventa nada salvo que se pase --crear-si-no-hay; entonces da de alta un cliente
 *     «Cliente Prueba Portal» (código {slug}-prueba-portal) con ese único teléfono, sin descuento.
 *
 * Uso:
 *   node dist/src/scripts/portal-cliente-prueba.js --tenant <slug> --telefono <10 dígitos> [--cliente <código>]
 *        [--crear-si-no-hay] [--aplicar] --proyecto-esperado <nombre>
 * Local: npx tsx --env-file=.env src/scripts/portal-cliente-prueba.ts --tenant dominique-ansel --telefono 5555020001
 * Dentro de Railway exige --proyecto-esperado (aborta antes de conectar). Fuera de Railway solo corre contra una base local.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { crearClienteB2b } from '../clientes/cliente-b2b';
import { normalizarTelefono } from '../common/telefono';

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
  const slug = val('--tenant');
  const crudo = val('--telefono');
  if (!slug || !crudo)
    throw new Error('Uso: --tenant <slug> --telefono <10 dígitos>');
  const telefono = normalizarTelefono(crudo);
  if (telefono.length !== 10)
    throw new Error('El teléfono debe tener 10 dígitos.');
  const aplicar = args.includes('--aplicar');
  const crear = args.includes('--crear-si-no-hay');
  const codigoElegido = val('--cliente');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error(`No existe el negocio "${slug}".`);
    if (tenant.tipoStorefront !== 'RETAIL_B2B')
      throw new Error(`"${slug}" no es un negocio de mayoreo.`);

    const clientes = await prisma.cliente.findMany({
      where: { tenantId: tenant.id, canal: 'B2B' },
      include: { telefonos: { orderBy: { createdAt: 'asc' } } },
      orderBy: { nombre: 'asc' },
    });
    const activos = clientes.filter((c) => c.bajaAt === null);
    log(`${aplicar ? 'APLICAR' : 'DRY-RUN'} — ${slug} (${tenant.id})`);
    log(
      `Clientes B2B: ${clientes.length} (activos: ${activos.length}, de baja: ${clientes.length - activos.length})`,
    );
    for (const c of clientes) {
      const tels =
        c.telefonos
          .map((t) => `${t.telefono}${t.principal ? '*' : ''}`)
          .join(', ') || '(sin teléfonos)';
      log(
        `  - ${c.codigo} · ${c.nombre}${c.bajaAt ? ' [BAJA]' : ''} · ${tels}`,
      );
    }
    const conTelefono = clientes.filter((c) =>
      c.telefonos.some((t) => t.telefono === telefono),
    );
    if (conTelefono.length > 0) {
      log(
        `El teléfono ${telefono} ya está en: ${conTelefono.map((c) => c.codigo).join(', ')}`,
      );
    }

    // ---- plan ----
    if (activos.length === 0) {
      if (!crear) {
        log(
          '\nNo hay clientes activos. PLAN (no aplicado): dar de alta «Cliente Prueba Portal» con este teléfono.\n' +
            'Para aplicarlo hay que pasar --crear-si-no-hay --aplicar.',
        );
        return;
      }
      log(
        `\nPLAN: alta de «Cliente Prueba Portal» (código ${slug}-prueba-portal) con teléfono principal ${telefono}.`,
      );
      if (!aplicar) return log('Dry-run: no se escribió nada.');
      const c = await crearClienteB2b(prisma, {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        sufijo: 'prueba-portal',
        nombre: 'Cliente Prueba Portal',
        direccion: 'Cliente de prueba del portal (staging)',
        telefonos: [{ telefono, principal: true }],
      });
      return log(`Creado: ${c.codigo}`);
    }

    const elegido =
      (codigoElegido && activos.find((c) => c.codigo === codigoElegido)) ||
      activos.find((c) => c.telefonos.some((t) => t.telefono === telefono)) ||
      activos[0];
    if (codigoElegido && elegido.codigo !== codigoElegido) {
      throw new Error(
        `El cliente activo "${codigoElegido}" no existe en ${slug}.`,
      );
    }
    const yaTiene = elegido.telefonos.find((t) => t.telefono === telefono);
    const principalActual = elegido.telefonos.find((t) => t.principal);
    log(`\nPLAN: cliente elegido → ${elegido.codigo} · ${elegido.nombre}`);
    if (yaTiene?.principal) {
      log('  El teléfono ya es su principal: no hay nada que cambiar.');
      return;
    }
    if (!yaTiene) log(`  + agregar el teléfono ${telefono}`);
    if (principalActual)
      log(
        `  ~ el principal actual ${principalActual.telefono} pasa a no principal (no se borra)`,
      );
    log(`  * ${telefono} queda como principal`);
    if (!aplicar)
      return log(
        '\nDry-run: no se escribió nada. Repite con --aplicar tras el OK.',
      );

    await prisma.$transaction(async (tx) => {
      // Bloquea al cliente (mismo patrón que la API de teléfonos) para no pisar un cambio simultáneo.
      await tx.$queryRaw`SELECT id FROM clientes WHERE id = ${elegido.id} FOR UPDATE`;
      await tx.clienteTelefono.updateMany({
        where: { clienteId: elegido.id, principal: true },
        data: { principal: false },
      });
      if (yaTiene) {
        await tx.clienteTelefono.update({
          where: { id: yaTiene.id },
          data: { principal: true },
        });
      } else {
        await tx.clienteTelefono.create({
          data: {
            tenantId: tenant.id,
            clienteId: elegido.id,
            telefono,
            principal: true,
          },
        });
      }
      const principales = await tx.clienteTelefono.count({
        where: { clienteId: elegido.id, principal: true },
      });
      if (principales !== 1)
        throw new Error(
          `Verificación fallida, rollback: ${principales} principales`,
        );
    });
    log('Aplicado.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  log(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
