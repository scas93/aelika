import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { usarSuite } from './helpers';

// A3 · script de corrección de contadores de Cliente (src/scripts/corregir-contadores.ts): dry-run que no
// escribe, --aplicar verificado e idempotente, --revert exacto, guarda de proyecto. Corre el script real
// como proceso (spawnSync: síncrono a propósito, los timers falsos de la suite no le afectan) contra la base _test.
describe('Script corregir-contadores', () => {
  const s = usarSuite();
  const d = (x: string) => new Date(`2026-09-${x}:00.000Z`);
  let n = 0;
  let folio = 0;

  const correr = (args: string[] = [], env: Record<string, string> = {}) => {
    const r = spawnSync('npx', ['tsx', 'src/scripts/corregir-contadores.ts', ...args], {
      cwd: join(__dirname, '../..'),
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    const lineas = r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, lineas, cambios: lineas.filter((l) => l.tipo === 'cambio') };
  };
  const estado = async () =>
    (await s.h.prisma.cliente.findMany({ orderBy: { id: 'asc' }, select: { id: true, nombre: true, totalPedidos: true, primerPedidoAt: true, ultimoPedidoAt: true, updatedAt: true } }));

  async function escenario() {
    const t = s.base.tenant.id;
    const cliente = (canal: 'B2C' | 'B2B', nombre: string, total: number, primer: string, ultimo: string, alta = '01T10:00') =>
      s.h.prisma.cliente.create({ data: { tenantId: t, canal, telefono: `55111000${++n}`, nombre, totalPedidos: total, primerPedidoAt: d(primer), ultimoPedidoAt: d(ultimo), createdAt: d(alta) } });
    const order = (c: { id: string }, mp: 'EFECTIVO' | 'TARJETA', ep: 'PAGADO' | 'PENDIENTE' | 'FALLIDO' | 'REEMBOLSADO', f: string) =>
      s.h.prisma.order.create({ data: { tenantId: t, clienteId: c.id, folio: `s${++folio}`, clienteNombre: 'x', clienteTelefono: '0', metodoPago: mp, estadoPago: ep, total: 10, createdAt: d(f) } });
    const b2b = (c: { id: string }, cancelado: boolean, f: string) =>
      s.h.prisma.pedidoB2b.create({
        data: { tenantId: t, clienteId: c.id, folio: `s${++folio}`, negocioNombre: 'n', contactoNombre: 'c', contactoTelefono: '0', contactoCorreo: 'x@y.z', semanaInicio: new Date('2026-09-28'), modoCobro: 'AL_FINAL', minimoPiezasAplicado: 1, cancelado, createdAt: d(f) } as any,
      });

    const c1 = await cliente('B2C', 'tarjeta-pendiente', 1, '10T12:00', '10T12:00'); // → 0
    await order(c1, 'TARJETA', 'PENDIENTE', '10T12:00');
    const c2 = await cliente('B2C', 'pagado-y-no-pagados', 3, '11T09:00', '13T09:00'); // → 1
    await order(c2, 'TARJETA', 'PAGADO', '11T09:00');
    await order(c2, 'TARJETA', 'PENDIENTE', '12T09:00');
    await order(c2, 'TARJETA', 'FALLIDO', '13T09:00');
    const c3 = await cliente('B2C', 'reembolsado', 1, '14T09:00', '14T09:00'); // → 0
    await order(c3, 'TARJETA', 'REEMBOLSADO', '14T09:00');
    const c4 = await cliente('B2C', 'ok-efectivo', 2, '15T09:00', '16T09:00'); // sin cambio
    await order(c4, 'EFECTIVO', 'PAGADO', '15T09:00');
    await order(c4, 'EFECTIVO', 'PAGADO', '16T09:00');
    const c5 = await cliente('B2C', 'lealtad-sin-pedidos', 0, '02T10:00', '02T10:00', '02T10:00'); // sin cambio
    await s.h.prisma.loyaltyCard.create({ data: { tenantId: t, clienteId: c5.id, token: 'tok-5' } });
    const c6 = await cliente('B2C', 'lealtad-con-pedido', 1, '03T10:00', '17T09:00', '03T10:00'); // primerPedidoAt cambia
    await s.h.prisma.loyaltyCard.create({ data: { tenantId: t, clienteId: c6.id, token: 'tok-6' } });
    await order(c6, 'EFECTIVO', 'PAGADO', '17T09:00');
    const c7 = await cliente('B2B', 'b2b-vivo-y-cancelado', 2, '18T09:00', '19T09:00'); // → 1
    await b2b(c7, false, '18T09:00');
    await b2b(c7, true, '19T09:00');
    const c8 = await cliente('B2B', 'b2b-solo-cancelado', 1, '20T09:00', '20T09:00'); // → 0
    await b2b(c8, true, '20T09:00');
    const c9 = await cliente('B2B', 'b2b-ok', 1, '21T09:00', '21T09:00'); // sin cambio
    await b2b(c9, false, '21T09:00');
    return { c1, c2, c3, c6, c7, c8 };
  }

  it('dry-run: no escribe nada, lista solo los que cambian con ids completos y un resumen sin datos personales', async () => {
    const e = await escenario();
    const antes = await estado();
    const r = correr();
    expect(r.status).toBe(0);
    expect(await estado()).toStrictEqual(antes);
    expect(r.lineas[0]).toMatchObject({ tipo: 'cabecera', modo: 'dry-run', totalClientes: 9, cambian: 6 });
    expect(r.lineas.at(-1)).toMatchObject({ tipo: 'fin', cambian: 6 });
    expect(r.cambios.map((c) => c.clienteId).sort()).toStrictEqual([e.c1, e.c2, e.c3, e.c6, e.c7, e.c8].map((c) => c.id).sort());
    const c2 = r.cambios.find((c) => c.clienteId === e.c2.id);
    expect(c2.antes.totalPedidos).toBe(3);
    expect(c2.despues).toMatchObject({ totalPedidos: 1, primerPedidoAt: '2026-09-11T09:00:00.000Z', ultimoPedidoAt: '2026-09-11T09:00:00.000Z' });
    const c1 = r.cambios.find((c) => c.clienteId === e.c1.id);
    expect(c1.despues).toMatchObject({ totalPedidos: 0, primerPedidoAt: '2026-09-01T10:00:00.000Z', ultimoPedidoAt: '2026-09-01T10:00:00.000Z' }); // fecha de alta
    // Resumen (stderr): ids truncados, lista aparte de Lealtad, sin nombres ni teléfonos.
    expect(r.stderr).toContain('Clientes que cambian: 6');
    expect(r.stderr).toContain(`Clientes de Lealtad cuyo primerPedidoAt cambia: 1`);
    expect(r.stderr).toContain(e.c6.id.slice(0, 8));
    expect(r.stderr).not.toContain(e.c6.id);
    expect(r.stderr).not.toMatch(/lealtad-con-pedido|tarjeta-pendiente|55111000/);
    expect(r.stdout).not.toMatch(/tarjeta-pendiente|55111000/); // el archivo tampoco lleva nombres ni teléfonos
  });

  it('--aplicar: aplica lo calculado, una segunda corrida no cambia nada (ni updatedAt) y el dry-run posterior sale vacío', async () => {
    const e = await escenario();
    const r = correr(['--aplicar']);
    expect(r.status).toBe(0);
    expect(r.lineas[0]).toMatchObject({ modo: 'aplicar', cambian: 6 });
    const despues = await estado();
    const por = (id: string) => despues.find((c) => c.id === id)!;
    expect(por(e.c1.id).totalPedidos).toBe(0);
    expect(por(e.c2.id)).toMatchObject({ totalPedidos: 1 });
    expect(por(e.c3.id).totalPedidos).toBe(0);
    expect(por(e.c6.id).primerPedidoAt.toISOString()).toBe('2026-09-17T09:00:00.000Z');
    expect(por(e.c7.id).totalPedidos).toBe(1);
    expect(por(e.c8.id).totalPedidos).toBe(0);

    const segunda = correr(['--aplicar']);
    expect(segunda.lineas[0]).toMatchObject({ cambian: 0 });
    expect(await estado()).toStrictEqual(despues);
    expect(correr().lineas[0]).toMatchObject({ cambian: 0 });
  });

  it('--tenant limita el alcance a ese negocio', async () => {
    await escenario();
    expect(correr(['--tenant', s.base.tenant.slug]).lineas[0]).toMatchObject({ cambian: 6 });
    const otro = await s.h.prisma.tenant.create({ data: { slug: 'otro', nombre: 'otro', botApiKey: 'k-otro' } });
    const c = await s.h.prisma.cliente.create({ data: { tenantId: otro.id, canal: 'B2C', telefono: '5599999999', nombre: 'o', totalPedidos: 4, primerPedidoAt: d('05T10:00'), ultimoPedidoAt: d('05T10:00'), createdAt: d('05T10:00') } });
    const solo = correr(['--tenant', 'otro']);
    expect(solo.lineas[0]).toMatchObject({ totalClientes: 1, cambian: 1 });
    expect(solo.cambios[0].clienteId).toBe(c.id);
    expect(correr(['--tenant', 'no-existe']).status).toBe(1);
  });

  it('--revert deja EXACTAMENTE los valores previos (incluido updatedAt); con desvío posterior exige --forzar; rechaza archivos truncados', async () => {
    const e = await escenario();
    const antes = await estado();
    const dir = mkdtempSync(join(tmpdir(), 'contadores-'));
    const archivo = join(dir, 'aplicar.ndjson');
    writeFileSync(archivo, correr(['--aplicar']).stdout);
    expect(await estado()).not.toStrictEqual(antes);

    // Un cliente cambia después de la corrección → revert sin --forzar se niega y no toca nada.
    await s.h.prisma.cliente.update({ where: { id: e.c2.id }, data: { totalPedidos: 5 } });
    const sinForzar = correr(['--revert', archivo]);
    expect(sinForzar.status).toBe(1);
    expect(sinForzar.stderr).toContain('--forzar');
    expect((await s.h.prisma.cliente.findUniqueOrThrow({ where: { id: e.c1.id } })).totalPedidos).toBe(0); // no se revirtió nada

    expect(correr(['--revert', archivo, '--forzar']).status).toBe(0);
    expect(await estado()).toStrictEqual(antes);

    const truncado = join(dir, 'truncado.ndjson');
    writeFileSync(truncado, correr().stdout.split('\n').slice(0, 2).join('\n'));
    const r = correr(['--revert', truncado]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('salida incompleta');
    expect(await estado()).toStrictEqual(antes);
  });

  it('--revert con el archivo de un dry-run también restaura (tras aplicar)', async () => {
    await escenario();
    const antes = await estado();
    const dir = mkdtempSync(join(tmpdir(), 'contadores-'));
    const archivo = join(dir, 'dry.ndjson');
    writeFileSync(archivo, correr().stdout);
    correr(['--aplicar']);
    expect(correr(['--revert', archivo]).status).toBe(0);
    expect(await estado()).toStrictEqual(antes);
  });

  it('guarda de proyecto: dentro de Railway exige --proyecto-esperado y aborta si no coincide, sin conectarse', async () => {
    const malaUrl = { DATABASE_URL: 'postgresql://x:y@127.0.0.1:1/nada' }; // si conectara, el error sería de conexión
    const sinFlag = correr([], { ...malaUrl, RAILWAY_PROJECT_NAME: 'merry-compassion' });
    expect(sinFlag.status).toBe(1);
    expect(sinFlag.stderr).toContain('--proyecto-esperado');
    const distinto = correr(['--proyecto-esperado', 'outstanding-compassion'], { ...malaUrl, RAILWAY_PROJECT_NAME: 'merry-compassion' });
    expect(distinto.status).toBe(1);
    expect(distinto.stderr).toContain('GUARDA');
    expect(distinto.stderr).toContain('Abortado sin conectar');
    expect(correr(['--aplicar', '--revert', 'x']).status).toBe(1);
  });
});
