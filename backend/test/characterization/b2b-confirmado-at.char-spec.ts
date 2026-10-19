import { EstadoPedido } from '../../generated/prisma/client';
import { usarSuite, AHORA } from './helpers';
import { apiRol, crearAdminB2b } from './b2b-helpers';

// Observabilidad del Dueño: DetalleB2B.confirmadoAt (primera confirmación). Solo pedidos creados DESPUÉS del corte
// CONFIRMADO_AT_DESDE; nunca se sobrescribe; sin dato en pedidos anteriores al corte, por confirmar o cancelados antes de confirmarse.
// Reloj fijo: miércoles 2026-09-30 10:00 CDMX (AHORA).
describe('B2B · confirmadoAt (primera confirmación)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  const entorno = process.env.CONFIRMADO_AT_DESDE;
  afterEach(() => {
    if (entorno === undefined) delete process.env.CONFIRMADO_AT_DESDE;
    else process.env.CONFIRMADO_AT_DESDE = entorno;
  });

  /** Corte N horas antes de AHORA (negativo = después). */
  const corte = (horasAntes: number) => {
    process.env.CONFIRMADO_AT_DESDE = new Date(
      new Date(AHORA).getTime() - horasAntes * 3600_000,
    ).toISOString();
  };
  const confirmadoAt = async (id: string) =>
    (await s.h.prisma.detalleB2B.findUniqueOrThrow({ where: { orderId: id } })).confirmadoAt;
  /** Simula «el cliente modificó y vuelve a Por confirmar» (el portal ya lo hace con Confirmado → Por confirmar). */
  const regresarAPorConfirmar = (id: string) =>
    s.h.prisma.order.update({ where: { id }, data: { estadoPedido: EstadoPedido.PENDIENTE_CONFIRMACION } });

  it('caminos de creación: el pedido nace Por confirmar y sin confirmadoAt', async () => {
    corte(24);
    const p = await crearAdminB2b(s.h, s.base);
    expect(p.estado).toBe('PENDIENTE_CONFIRMACION');
    expect(await confirmadoAt(p.id)).toBeNull();
  });

  it('avanzar (primera confirmación) guarda la fecha', async () => {
    corte(24);
    const p = await crearAdminB2b(s.h, s.base);
    await dueno().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
    expect((await confirmadoAt(p.id))?.toISOString()).toBe(AHORA);
  });

  it('reconfirmar no sobrescribe la primera fecha', async () => {
    corte(24);
    const p = await crearAdminB2b(s.h, s.base);
    await dueno().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
    await regresarAPorConfirmar(p.id);
    jest.setSystemTime(new Date(new Date(AHORA).getTime() + 5 * 3600_000));
    await dueno().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
    expect((await confirmadoAt(p.id))?.toISOString()).toBe(AHORA);
  });

  it('marcarPagado en AL_INICIO confirma y guarda la fecha; reconfirmar no la sobrescribe', async () => {
    corte(24);
    const p = await crearAdminB2b(s.h, s.base, { modalidadPago: 'AL_INICIO' });
    await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
    expect((await confirmadoAt(p.id))?.toISOString()).toBe(AHORA);
    await dueno().patch(`/pedidos-b2b/${p.id}/desmarcar-pagado`).expect(200);
    await regresarAPorConfirmar(p.id);
    jest.setSystemTime(new Date(new Date(AHORA).getTime() + 5 * 3600_000));
    await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
    expect((await confirmadoAt(p.id))?.toISOString()).toBe(AHORA);
  });

  it('marcarPagado en AL_FINAL no confirma y no guarda confirmadoAt', async () => {
    corte(24);
    const p = await crearAdminB2b(s.h, s.base, { modalidadPago: 'AL_FINAL' });
    await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
    expect(await confirmadoAt(p.id)).toBeNull();
  });

  it('un pedido anterior al corte, confirmado y reconfirmado, sigue sin confirmadoAt', async () => {
    corte(-1); // el corte es 1 h DESPUÉS de la creación del pedido (que nace en AHORA)
    const p = await crearAdminB2b(s.h, s.base);
    await dueno().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
    expect(await confirmadoAt(p.id)).toBeNull();
    await regresarAPorConfirmar(p.id);
    jest.setSystemTime(new Date(new Date(AHORA).getTime() + 5 * 3600_000));
    await dueno().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
    expect(await confirmadoAt(p.id)).toBeNull();
  });

  it('sin corte configurado (o inválido) no se registra nada', async () => {
    delete process.env.CONFIRMADO_AT_DESDE;
    const a = await crearAdminB2b(s.h, s.base);
    await dueno().patch(`/pedidos-b2b/${a.id}/avanzar`).expect(200);
    expect(await confirmadoAt(a.id)).toBeNull();
    process.env.CONFIRMADO_AT_DESDE = 'no-es-fecha';
    const b = await crearAdminB2b(s.h, s.base);
    await dueno().patch(`/pedidos-b2b/${b.id}/avanzar`).expect(200);
    expect(await confirmadoAt(b.id)).toBeNull();
  });

  it('un pedido cancelado antes de confirmarse queda sin fecha', async () => {
    corte(24);
    const p = await crearAdminB2b(s.h, s.base);
    await dueno().patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200);
    expect(await confirmadoAt(p.id)).toBeNull();
  });

  it('el campo no sale en ninguna respuesta del pedido', async () => {
    corte(24);
    const p = await crearAdminB2b(s.h, s.base);
    const r = await dueno().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
    const detalle = await dueno().get(`/pedidos-b2b/${p.id}`).expect(200);
    expect(JSON.stringify([r.body, detalle.body])).not.toContain('confirmadoAt');
  });
});
