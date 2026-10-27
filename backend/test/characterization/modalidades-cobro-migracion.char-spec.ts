import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedBase } from './db';
import { usarSuite } from './helpers';
import { apiRol, SEMANA_PROXIMA } from './b2b-helpers';
import { crearClienteB2b } from '../../src/clientes/cliente-b2b';

// Configuración de pagos, Fase 0 · script de datos src/scripts/modalidades-cobro-b2b.ts: prueba en seco que no escribe,
// --aplicar verificado e idempotente, --revert exacto, guarda de proyecto y pedidos intactos. Corre el script real como proceso
// contra la base _test.
describe('Script modalidades-cobro-b2b', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  let n = 0;

  const correr = (args: string[] = [], env: Record<string, string> = {}) => {
    const r = spawnSync(
      'npx',
      ['tsx', 'src/scripts/modalidades-cobro-b2b.ts', ...args],
      {
        cwd: join(__dirname, '../..'),
        env: { ...process.env, ...env },
        encoding: 'utf8',
      },
    );
    const lineas = r.stdout
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l));
    return {
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      lineas,
      cambios: lineas.filter(
        (l) => l.tipo === 'tenant' || l.tipo === 'cliente',
      ),
      antes: lineas.find((l) => l.tipo === 'antes')?.negocios as any[],
      despues: lineas.find((l) => l.tipo === 'despues')?.negocios as any[],
    };
  };

  const sinModalidad = (tenantId: string, nombre: string, baja = false) =>
    s.h.prisma.cliente.create({
      data: {
        tenantId,
        canal: 'B2B',
        telefono: null,
        codigo: `cod-${++n}`,
        nombre,
        direccion: 'Calle 1',
        modalidadPago: null,
        bajaAt: baja ? new Date('2026-09-01T00:00:00.000Z') : null,
        totalPedidos: 0,
        primerPedidoAt: new Date('2026-09-01T00:00:00.000Z'),
        ultimoPedidoAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });
  const estado = async () => ({
    clientes: await s.h.prisma.cliente.findMany({
      orderBy: { nombre: 'asc' },
      select: { nombre: true, modalidadPago: true, updatedAt: true },
    }),
    tenants: await s.h.prisma.tenant.findMany({
      orderBy: { slug: 'asc' },
      select: {
        slug: true,
        modalidadesCobroB2b: true,
        pedidoB2bModoCobro: true,
      },
    }),
    pedidos: await s.h.prisma.detalleB2B.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, modoCobro: true },
    }),
  });

  /**
   * T1 (base): modo AL_INICIO sin tocar las casillas (default ["AL_FINAL"]) → debe pasar a ["AL_INICIO"].
   *    clientes: «Nulo activo» y «Nulo baja» (NULL), «Explícito crédito» (AL_FINAL, quedará inactivo) + un pedido.
   * T2: modo AL_FINAL, un cliente NULL → AL_FINAL, casillas sin cambio.
   * T3: ya configurado con ambas casillas (modo AL_INICIO): NO se pisa; su NULL recibe AL_INICIO.
   * T4: negocio de menudeo: fuera del alcance.
   */
  async function escenario() {
    const t1 = s.base.tenant.id;
    await s.h.prisma.tenant.update({
      where: { id: t1 },
      data: {
        pedidoB2bModoCobro: 'AL_INICIO',
        modalidadesCobroB2b: ['AL_FINAL'],
      },
    });
    await sinModalidad(t1, 'Nulo activo');
    await sinModalidad(t1, 'Nulo baja', true);
    const explicito = await crearClienteB2b(s.h.prisma, {
      tenantId: t1,
      tenantSlug: s.base.tenant.slug,
      sufijo: 'explicito',
      nombre: 'Explícito crédito',
      direccion: 'Calle 1',
      modalidadPago: 'AL_FINAL',
      modalidadesActivas: ['AL_FINAL'],
      telefonos: [{ telefono: '5511112222' }],
    });
    await apiRol(s.h, s.base, 'GERENTE')
      .post('/pedidos-b2b')
      .send({
        clienteId: explicito.id,
        semanaInicio: SEMANA_PROXIMA,
        items: [
          {
            productId: s.base.productoA.id,
            distribucion: [{ dia: 'LUNES', cantidad: 12 }],
          },
        ],
      })
      .expect(201);

    const mk = async (slug: string, tipo: 'RETAIL_B2B' | 'RETAIL_B2C') =>
      (await seedBase(s.h.prisma, { slug, tipoStorefront: tipo })).tenant.id;
    const t2 = await mk('may-dos', 'RETAIL_B2B');
    await s.h.prisma.tenant.update({
      where: { id: t2 },
      data: {
        pedidoB2bModoCobro: 'AL_FINAL',
        modalidadesCobroB2b: ['AL_FINAL'],
      },
    });
    await sinModalidad(t2, 'Nulo dos');
    const t3 = await mk('may-tres', 'RETAIL_B2B');
    await s.h.prisma.tenant.update({
      where: { id: t3 },
      data: {
        pedidoB2bModoCobro: 'AL_INICIO',
        modalidadesCobroB2b: ['AL_FINAL', 'AL_INICIO'],
      },
    });
    await sinModalidad(t3, 'Nulo tres');
    await mk('menudeo-cuatro', 'RETAIL_B2C');
  }

  it('prueba en seco: reporta antes/después reales (sin NULL ni cambios en pedidos) y NO escribe nada', async () => {
    await escenario();
    const antesDb = await estado();
    const r = correr();
    expect(r.status).toBe(0);
    expect(await estado()).toStrictEqual(antesDb);

    const por = (lista: any[], slug: string) =>
      lista.find((x) => x.slug === slug);
    // Negocios en alcance: los tres de mayoreo (no el de menudeo).
    expect(r.antes.map((x) => x.slug).sort()).toStrictEqual(
      [s.base.tenant.slug, 'may-dos', 'may-tres'].sort(),
    );
    const a1 = por(r.antes, s.base.tenant.slug);
    const d1 = por(r.despues, s.base.tenant.slug);
    expect(a1.activas).toStrictEqual(['AL_FINAL']);
    expect(d1.activas).toStrictEqual(['AL_INICIO']);
    expect(a1.clientes).toStrictEqual({
      activos: { AL_FINAL: 1, AL_INICIO: 0, NULL: 1 },
      baja: { AL_FINAL: 0, AL_INICIO: 0, NULL: 1 },
    });
    expect(d1.clientes).toStrictEqual({
      activos: { AL_FINAL: 1, AL_INICIO: 1, NULL: 0 },
      baja: { AL_FINAL: 0, AL_INICIO: 1, NULL: 0 },
    });
    // El cliente explícito en «A crédito» se conserva aunque su negocio quede solo con «Pago por adelantado» → se reporta aparte.
    expect(d1.clientesConModalidadInactiva).toBe(1);
    // Pedidos: misma cuenta y misma huella antes y después.
    expect(d1.pedidos).toStrictEqual(a1.pedidos);
    expect(a1.pedidos.total).toBe(1);
    expect(a1.pedidos.porModoCobro).toStrictEqual({ AL_FINAL: 1 });
    // T3 ya estaba configurado: no cambia sus casillas, solo recibe modalidad su cliente NULL.
    expect(por(r.despues, 'may-tres').activas).toStrictEqual([
      'AL_FINAL',
      'AL_INICIO',
    ]);
    expect(r.stderr).toContain('PRUEBA EN SECO');
    expect(r.stderr).toContain('Negocios ya configurados');
    // 1 cambio de negocio (T1) + 4 clientes (2 en T1, 1 en T2, 1 en T3).
    expect(r.cambios.filter((c) => c.tipo === 'tenant')).toHaveLength(1);
    expect(r.cambios.filter((c) => c.tipo === 'cliente')).toHaveLength(4);
  });

  it('--aplicar: deja activa solo la modalidad del negocio, da modalidad a TODO cliente NULL (también de baja) y es idempotente', async () => {
    await escenario();
    const r = correr(['--aplicar']);
    expect(r.status).toBe(0);
    const db = await estado();
    const modalidad = (nombre: string) =>
      db.clientes.find((c) => c.nombre === nombre)!.modalidadPago;
    expect(modalidad('Nulo activo')).toBe('AL_INICIO'); // heredaba el AL_INICIO de su negocio
    expect(modalidad('Nulo baja')).toBe('AL_INICIO');
    expect(modalidad('Explícito crédito')).toBe('AL_FINAL'); // explícito: no se toca
    expect(modalidad('Nulo dos')).toBe('AL_FINAL');
    expect(modalidad('Nulo tres')).toBe('AL_INICIO');
    expect(
      await s.h.prisma.cliente.count({
        where: { canal: 'B2B', modalidadPago: null },
      }),
    ).toBe(0);
    const t = (slug: string) => db.tenants.find((x) => x.slug === slug)!;
    expect(t(s.base.tenant.slug).modalidadesCobroB2b).toStrictEqual([
      'AL_INICIO',
    ]);
    expect(t('may-dos').modalidadesCobroB2b).toStrictEqual(['AL_FINAL']);
    expect(t('may-tres').modalidadesCobroB2b).toStrictEqual([
      'AL_FINAL',
      'AL_INICIO',
    ]);
    expect(t('menudeo-cuatro').modalidadesCobroB2b).toStrictEqual(['AL_FINAL']); // fuera de alcance
    // Pedidos intactos.
    expect(db.pedidos).toHaveLength(1);
    expect(db.pedidos[0].modoCobro).toBe('AL_FINAL');
    // Segunda corrida: nada que cambiar.
    const otra = correr(['--aplicar']);
    expect(otra.status).toBe(0);
    expect(otra.cambios).toHaveLength(0);
    expect(await estado()).toStrictEqual(db);
  });

  it('--revert (con el archivo de --aplicar) deja los clientes y negocios EXACTAMENTE como estaban; con desvío exige --forzar; rechaza archivos truncados', async () => {
    await escenario();
    const antes = await estado();
    const dir = mkdtempSync(join(tmpdir(), 'modalidades-'));
    const archivo = join(dir, 'aplicado.ndjson');
    writeFileSync(archivo, correr(['--aplicar']).stdout);

    // Un cliente cambia después (alguien le asigna otra modalidad) → revert se niega y no toca nada.
    await s.h.prisma.cliente.updateMany({
      where: { nombre: 'Nulo activo' },
      data: { modalidadPago: 'AL_FINAL' },
    });
    const despuesDeDesvio = await estado();
    const sinForzar = correr(['--revert', archivo]);
    expect(sinForzar.status).toBe(1);
    expect(sinForzar.stderr).toContain('--forzar');
    expect(await estado()).toStrictEqual(despuesDeDesvio);

    expect(correr(['--revert', archivo, '--forzar']).status).toBe(0);
    const revertido = await estado();
    expect(revertido.clientes).toStrictEqual(antes.clientes); // incluido updatedAt
    expect(revertido.tenants).toStrictEqual(antes.tenants);
    expect(revertido.pedidos).toStrictEqual(antes.pedidos);

    const truncado = join(dir, 'truncado.ndjson');
    writeFileSync(truncado, correr().stdout.split('\n').slice(0, 2).join('\n'));
    const r = correr(['--revert', truncado]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('línea final');
  });

  it('--revert sin desvíos (flujo normal) funciona sin --forzar', async () => {
    await escenario();
    const antes = await estado();
    const dir = mkdtempSync(join(tmpdir(), 'modalidades-'));
    const archivo = join(dir, 'aplicado.ndjson');
    writeFileSync(archivo, correr(['--aplicar']).stdout);
    expect(correr(['--revert', archivo]).status).toBe(0);
    const revertido = await estado();
    expect(revertido.clientes).toStrictEqual(antes.clientes);
    expect(revertido.tenants).toStrictEqual(antes.tenants);
  });

  it('guarda de proyecto: dentro de Railway exige --proyecto-esperado y aborta si no coincide, sin conectarse', () => {
    const env = {
      RAILWAY_PROJECT_NAME: 'merry-compassion',
      DATABASE_URL: 'postgresql://nadie:x@127.0.0.1:1/nada',
    };
    const sinFlag = correr([], env);
    expect(sinFlag.status).toBe(1);
    expect(sinFlag.stderr).toContain('--proyecto-esperado');
    const distinto = correr(
      ['--proyecto-esperado', 'outstanding-compassion'],
      env,
    );
    expect(distinto.status).toBe(1);
    expect(distinto.stderr).toContain('GUARDA');
    expect(correr(['--proyecto-esperado', 'x']).stderr).toContain('GUARDA'); // fuera de Railway
    expect(correr(['--aplicar', '--revert', 'x']).status).toBe(1);
  });
});
