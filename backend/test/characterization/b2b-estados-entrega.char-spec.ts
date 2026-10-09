import { seedCodigoDescuento } from './db';
import { expectError } from './exacto';
import { usarSuite } from './helpers';
import { apiRol, cerrarEntregasB2b, crearAdminB2b, SEMANA_ACTUAL } from './b2b-helpers';

// Estados B2B por entrega (docs/diseno-operacion.md, "Flujo operativo y estados" y "Cobranza"): Por confirmar → Confirmado
// (manual) → En proceso → Completado (calculados de las entregas), Cancelado = flag. Cierre de entregas una por una.
// El pedido por defecto de bodyB2b tiene 3 entregas (LUN 10-05 $270, MIE 10-07 $270, VIE 10-09 $122; total $662).
describe('B2B · estados por entrega', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  const operador = () => apiRol(s.h, s.base, 'OPERADOR');
  const ruta = (id: string, entregaId: string) => `/pedidos-b2b/${id}/entregas/${entregaId}/cerrar`;

  const detalle = async (id: string) => (await dueno().get(`/pedidos-b2b/${id}`).expect(200)).body;
  const estados = async (id: string) => (await detalle(id)).entregas.map((e: any) => e.estado);
  // "Pedidos activos" del panel: Por confirmar + Confirmado + En proceso, sin cancelados (filtro multi-estado del export).
  const activos = async () => {
    const res = await dueno().get('/pedidos-b2b/export?estados=PENDIENTE_CONFIRMACION,CONFIRMADO_SURTIENDO,EN_PROCESO&cancelado=false').expect(200);
    return res.text.split('\r\n').slice(1).filter(Boolean).map((l: string) => l.split(',')[0]);
  };
  const confirmado = async (extra: Record<string, unknown> = {}) => {
    const p = await crearAdminB2b(s.h, s.base, extra);
    await dueno().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
    return p;
  };

  describe('estado del pedido calculado de sus entregas', () => {
    it('3 entregas: confirmar → Confirmado; cerrar 1 → En proceso; cerrar las 3 → Completado, sale de activos y entra a Históricos', async () => {
      const p = await confirmado();
      expect((await detalle(p.id)).estado).toBe('CONFIRMADO_SURTIENDO');
      const [e1, e2, e3] = (await detalle(p.id)).entregas;

      expect((await dueno().patch(ruta(p.id, e1.id)).send({ estado: 'ENTREGADA' }).expect(200)).body.estado).toBe('EN_PROCESO');
      expect(await activos()).toStrictEqual([p.folio]);

      expect((await dueno().patch(ruta(p.id, e2.id)).send({ estado: 'NO_RECOGIDA' }).expect(200)).body.estado).toBe('EN_PROCESO');
      expect((await dueno().patch(ruta(p.id, e3.id)).send({ estado: 'ENTREGADA' }).expect(200)).body.estado).toBe('COMPLETADO');

      expect(await activos()).toStrictEqual([]);
      expect((await dueno().get('/pedidos-b2b?estado=COMPLETADO').expect(200)).body.data.map((x: any) => x.id)).toStrictEqual([p.id]);
    });

    it('con una sola entrega pasa directo de Confirmado a Completado', async () => {
      const p = await confirmado({ items: [{ productId: s.base.productoA.id, distribucion: [{ dia: 'LUNES', cantidad: 12 }] }] });
      const [e] = (await detalle(p.id)).entregas;
      expect((await dueno().patch(ruta(p.id, e.id)).send({ estado: 'ENTREGADA' }).expect(200)).body.estado).toBe('COMPLETADO');
    });

    it('guarda fecha y hora del cierre, sin usuario', async () => {
      const p = await confirmado();
      const [e] = (await detalle(p.id)).entregas;
      const res = await operador().patch(ruta(p.id, e.id)).send({ estado: 'ENTREGADA' }).expect(200);
      const cerrada = res.body.entregas.find((x: any) => x.id === e.id);
      expect(cerrada).toMatchObject({ estado: 'ENTREGADA', cerradaAt: '2026-09-30T16:00:00.000Z' });
      const fila = await s.h.prisma.entrega.findUniqueOrThrow({ where: { id: e.id } });
      expect(fila.estadoCambiadoAt?.toISOString()).toBe('2026-09-30T16:00:00.000Z');
      expect(fila.estadoCambiadoPorId).toBeNull();
    });
  });

  describe('cerrar una entrega: permisos y rechazos', () => {
    it('un Operador puede cerrar entregas (los 3 roles); y también cancelar (pedido no pagado)', async () => {
      const p = await confirmado();
      const [e] = (await detalle(p.id)).entregas;
      await operador().patch(ruta(p.id, e.id)).send({ estado: 'NO_RECOGIDA' }).expect(200);
      expect((await operador().patch(`/pedidos-b2b/${p.id}/cancelar`)).status).toBe(200);
    });

    it('solo pedidos Confirmados o En proceso: Por confirmar y Cancelado dan 409', async () => {
      const sinConfirmar = await crearAdminB2b(s.h, s.base);
      const [e] = (await detalle(sinConfirmar.id)).entregas;
      expectError(
        await dueno().patch(ruta(sinConfirmar.id, e.id)).send({ estado: 'ENTREGADA' }),
        409,
        'Solo se pueden cerrar entregas de pedidos confirmados o en proceso',
      );
      const c = await confirmado({ contactoTelefono: '5500000001' });
      const [ec] = (await detalle(c.id)).entregas;
      await dueno().patch(`/pedidos-b2b/${c.id}/cancelar`).expect(200);
      expectError(await dueno().patch(ruta(c.id, ec.id)).send({ estado: 'ENTREGADA' }), 409, 'Este pedido está cancelado');
    });

    it('una entrega ya cerrada no se vuelve a cerrar (409); id ajeno 404; "CANCELADA" y otros valores 400', async () => {
      const p = await confirmado();
      const [e1, e2] = (await detalle(p.id)).entregas;
      await dueno().patch(ruta(p.id, e1.id)).send({ estado: 'ENTREGADA' }).expect(200);
      expectError(await dueno().patch(ruta(p.id, e1.id)).send({ estado: 'NO_RECOGIDA' }), 409, 'Esta entrega ya está cerrada');
      expectError(await dueno().patch(ruta(p.id, '00000000-0000-4000-8000-000000000000')).send({ estado: 'ENTREGADA' }), 404, 'Entrega no encontrada');
      for (const estado of ['CANCELADA', 'PENDIENTE', 'LISTA', 'nope']) {
        expect((await dueno().patch(ruta(p.id, e2.id)).send({ estado })).status).toBe(400);
      }
      expect((await dueno().patch(ruta(p.id, e2.id)).send({})).status).toBe(400);
      expect(await estados(p.id)).toStrictEqual(['ENTREGADA', 'PENDIENTE', 'PENDIENTE']);
    });

    it('la entrega de un pedido no se puede cerrar por la ruta de otro (404)', async () => {
      const a = await confirmado();
      const b = await confirmado({ contactoTelefono: '5500000001' });
      const [eb] = (await detalle(b.id)).entregas;
      expectError(await dueno().patch(ruta(a.id, eb.id)).send({ estado: 'ENTREGADA' }), 404, 'Entrega no encontrada');
    });
  });

  describe('cancelar un pedido con entregas ya cerradas', () => {
    it('En proceso con 1 Entregada y 2 Pendientes: queda Cancelado, la Entregada se conserva, las 2 pasan a Canceladas y el total solo incluye la Entregada', async () => {
      const p = await confirmado();
      const [e1] = (await detalle(p.id)).entregas;
      await dueno().patch(ruta(p.id, e1.id)).send({ estado: 'ENTREGADA' }).expect(200);

      const res = await dueno().patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200);
      expect(res.body).toMatchObject({ cancelado: true, subtotal: '270', descuentoTotal: '0', total: '270' });
      const d = await detalle(p.id);
      expect(d.entregas.map((e: any) => e.estado)).toStrictEqual(['ENTREGADA', 'CANCELADA', 'CANCELADA']);
      expect(d.cancelado).toBe(true);
    });

    it('una No recogida se cobra igual que una Entregada', async () => {
      const p = await confirmado();
      const [e1] = (await detalle(p.id)).entregas;
      await dueno().patch(ruta(p.id, e1.id)).send({ estado: 'NO_RECOGIDA' }).expect(200);
      const res = await dueno().patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200);
      expect(res.body.total).toBe('270');
      expect(await estados(p.id)).toStrictEqual(['NO_RECOGIDA', 'CANCELADA', 'CANCELADA']);
    });

    it('el % de descuento del pedido se aplica solo a las entregas vigentes', async () => {
      await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'PROMO10', porcentaje: '10.00' });
      const p = await confirmado({ codigoDescuento: 'PROMO10' });
      const [e1] = (await detalle(p.id)).entregas;
      await dueno().patch(ruta(p.id, e1.id)).send({ estado: 'ENTREGADA' }).expect(200);
      const res = await dueno().patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200);
      expect(res.body).toMatchObject({ subtotal: '270', descuentoTotal: '27', total: '243' });
    });

    it('se puede cancelar en Por confirmar (total 0) y no en Completado ni Cancelado', async () => {
      const a = await crearAdminB2b(s.h, s.base);
      expect((await dueno().patch(`/pedidos-b2b/${a.id}/cancelar`).expect(200)).body.total).toBe('0');
      expectError(await dueno().patch(`/pedidos-b2b/${a.id}/cancelar`), 409, 'Este pedido ya está cancelado');

      const b = await confirmado({ contactoTelefono: '5500000001' });
      await cerrarEntregasB2b(dueno(), b.id);
      expectError(await dueno().patch(`/pedidos-b2b/${b.id}/cancelar`), 409, 'No puedes cancelar un pedido ya completado');
    });

    it('el pedido cancelado no vuelve a aparecer en Entregas del día salvo por sus entregas cerradas', async () => {
      const p = await confirmado();
      const [e1] = (await detalle(p.id)).entregas; // 2026-10-05
      await dueno().patch(ruta(p.id, e1.id)).send({ estado: 'ENTREGADA' }).expect(200);
      await dueno().patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200);
      const lunes = (await dueno().get('/pedidos-b2b/dia/2026-10-05').expect(200)).body;
      expect(lunes.map((r: any) => [r.folio, r.entregaEstado, r.cancelado])).toStrictEqual([[p.folio, 'ENTREGADA', true]]);
      expect((await dueno().get('/pedidos-b2b/dia/2026-10-07').expect(200)).body).toStrictEqual([]); // Cancelada: no aparece
    });
  });

  describe('edición de un pedido con entregas cerradas', () => {
    const cuerpo = (productId: string, dias: [string, number][]) => ({ items: [{ productId, distribucion: dias.map(([dia, cantidad]) => ({ dia, cantidad })) }] });

    it('agregar una entrega a un pedido Completado lo regresa a En proceso (y a Pedidos activos)', async () => {
      const p = await confirmado();
      await cerrarEntregasB2b(dueno(), p.id);
      expect((await detalle(p.id)).estado).toBe('COMPLETADO');

      // mismo contenido + una entrega nueva el SÁBADO (las 3 cerradas no se tocan)
      const res = await dueno()
        .patch(`/pedidos-b2b/${p.id}/items`)
        .send({
          items: [
            { productId: s.base.productoA.id, distribucion: [{ dia: 'LUNES', cantidad: 6 }, { dia: 'MIERCOLES', cantidad: 6 }, { dia: 'SABADO', cantidad: 3 }] },
            { productId: s.base.productoB.id, distribucion: [{ dia: 'VIERNES', cantidad: 4 }] },
          ],
        })
        .expect(200);
      expect(res.body.estado).toBe('EN_PROCESO');
      expect(await estados(p.id)).toStrictEqual(['ENTREGADA', 'ENTREGADA', 'ENTREGADA', 'PENDIENTE']);
      expect(await activos()).toStrictEqual([p.folio]);
    });

    it('las entregas ya cerradas no se editan: cambiar o quitar una da 409 y no cambia nada', async () => {
      const p = await confirmado();
      const [e1] = (await detalle(p.id)).entregas;
      await dueno().patch(ruta(p.id, e1.id)).send({ estado: 'ENTREGADA' }).expect(200);
      const r = await dueno().patch(`/pedidos-b2b/${p.id}/items`).send(cuerpo(s.base.productoA.id, [['MIERCOLES', 12]]));
      expect(r.status).toBe(409);
      // Fase 1b: mensaje legible (fecha en español, estado real y a dónde ir).
      expect(r.body.message).toBe('La entrega del lun 5 de oct ya está cerrada (Entregada). Para cambiarla usa «Corregir» en esa entrega.');
      expect(await estados(p.id)).toStrictEqual(['ENTREGADA', 'PENDIENTE', 'PENDIENTE']);
    });

    it('CAMBIA A PROPÓSITO (Fase 1b): un pedido pagado SÍ se edita (Gerente/Dueño) y sigue Pagado', async () => {
      const p = await confirmado();
      await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      await dueno().patch(`/pedidos-b2b/${p.id}/items`).send(cuerpo(s.base.productoA.id, [['LUNES', 12]])).expect(200);
      expect((await detalle(p.id)).estadoPago).toBe('PAGADO');
    });
  });

  describe('entregas atrasadas', () => {
    it('una entrega de un día anterior a hoy (CDMX) que sigue Pendiente se marca Atrasada, en el día y en el detalle; no se cierra sola', async () => {
      const p = await confirmado({ semanaInicio: SEMANA_ACTUAL }); // hoy = miércoles 09-30: LUN 09-28 ya pasó, MIE 09-30 es hoy, VIE 10-02 es futuro
      const d = await detalle(p.id);
      expect(d.entregas.map((e: any) => [e.fecha.slice(0, 10), e.estado, e.atrasada])).toStrictEqual([
        ['2026-09-28', 'PENDIENTE', true],
        ['2026-09-30', 'PENDIENTE', false],
        ['2026-10-02', 'PENDIENTE', false],
      ]);
      const ayer = (await dueno().get('/pedidos-b2b/dia/2026-09-28').expect(200)).body;
      expect(ayer.map((r: any) => [r.folio, r.entregaEstado, r.atrasada])).toStrictEqual([[p.folio, 'PENDIENTE', true]]);
      const hoy = (await dueno().get('/pedidos-b2b/dia/2026-09-30').expect(200)).body;
      expect(hoy.map((r: any) => r.atrasada)).toStrictEqual([false]);
    });

    it('una entrega atrasada que se cierra deja de estar atrasada', async () => {
      const p = await confirmado({ semanaInicio: SEMANA_ACTUAL });
      const [e1] = (await detalle(p.id)).entregas;
      await dueno().patch(ruta(p.id, e1.id)).send({ estado: 'NO_RECOGIDA' }).expect(200);
      const ayer = (await dueno().get('/pedidos-b2b/dia/2026-09-28').expect(200)).body;
      expect(ayer.map((r: any) => [r.entregaEstado, r.atrasada])).toStrictEqual([['NO_RECOGIDA', false]]);
    });
  });

  describe('datos previos a la migración', () => {
    it('un pedido B2B que aún está en DESPACHADO se lee como COMPLETADO y no se puede cancelar', async () => {
      const p = await confirmado();
      await s.h.prisma.order.update({ where: { id: p.id }, data: { estadoPedido: 'DESPACHADO' } });
      await s.h.prisma.entrega.updateMany({ where: { orderId: p.id }, data: { estado: 'ENTREGADA' } });
      expect((await detalle(p.id)).estado).toBe('COMPLETADO');
      expect((await dueno().get('/pedidos-b2b?estado=COMPLETADO').expect(200)).body.data.map((x: any) => x.id)).toStrictEqual([p.id]);
      expectError(await dueno().patch(`/pedidos-b2b/${p.id}/cancelar`), 409, 'No puedes cancelar un pedido ya completado');
    });
  });
});
