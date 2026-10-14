import { Role } from '../../generated/prisma/client';
import { puedeEditarPedidoPagado } from '../../src/pedidos-b2b/pedidos-b2b-estados';
import { configurarB2b, seedCodigoDescuento } from './db';
import { expectError } from './exacto';
import { usarSuite } from './helpers';
import { apiRol, bodyB2b, cerrarEntregasB2b, crearAdminB2b } from './b2b-helpers';

// Fase 1b — pago y corrección del admin (docs/diseno-operacion.md: "Estado de pago", "Roles y permisos", flujo y estados §6).
// Pedido por defecto de bodyB2b: Café americano $45 (LUN 6 + MIE 6) y Concha $30.50 (VIE 4) → 3 entregas
// (LUN 10-05 $270, MIE 10-07 $270, VIE 10-09 $122), total $662. Reloj fijo: miércoles 2026-09-30 10:00 CDMX.
describe('B2B · pago y corrección del admin (Fase 1b)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  const gerente = () => apiRol(s.h, s.base, 'GERENTE');
  const operador = () => apiRol(s.h, s.base, 'OPERADOR');
  const A = () => s.base.productoA.id;
  const B = () => s.base.productoB.id;

  const detalle = async (id: string) => (await dueno().get(`/pedidos-b2b/${id}`).expect(200)).body;
  const confirmado = async (extra: Record<string, unknown> = {}) => {
    const p = await crearAdminB2b(s.h, s.base, extra);
    await dueno().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
    return p;
  };
  const completado = async (extra: Record<string, unknown> = {}) => {
    const p = await confirmado(extra);
    await cerrarEntregasB2b(dueno(), p.id);
    return p;
  };
  const entregaDe = (d: any, dia: string) => d.entregas.find((e: any) => e.dia === dia);
  const lineas = (items: [string, number][]) => ({ items: items.map(([productId, cantidad]) => ({ productId, cantidad })) });
  const invariante = async (id: string) => {
    for (const item of await s.h.prisma.orderItem.findMany({ where: { orderId: id }, include: { entregaItems: true } })) {
      expect(item.cantidad).toBe(item.entregaItems.reduce((n, ei) => n + ei.cantidad, 0));
    }
    const piezas = (await s.h.prisma.orderItem.aggregate({ where: { orderId: id }, _sum: { cantidad: true } }))._sum.cantidad;
    expect((await s.h.prisma.detalleB2B.findUniqueOrThrow({ where: { orderId: id } })).totalPiezas).toBe(piezas);
  };

  describe('estado de pago', () => {
    it('marcar guarda la fecha y hora; desmarcar regresa a Pendiente y la limpia', async () => {
      const p = await crearAdminB2b(s.h, s.base);
      expect(await detalle(p.id)).toMatchObject({ estadoPago: 'PENDIENTE', pagadoAt: null });

      const marcado = await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      expect(marcado.body.estadoPago).toBe('PAGADO');
      expect(await detalle(p.id)).toMatchObject({ estadoPago: 'PAGADO', pagadoAt: '2026-09-30T16:00:00.000Z' });

      const desmarcado = await dueno().patch(`/pedidos-b2b/${p.id}/desmarcar-pagado`).expect(200);
      expect(desmarcado.body.estadoPago).toBe('PENDIENTE');
      expect(await detalle(p.id)).toMatchObject({ estadoPago: 'PENDIENTE', pagadoAt: null });
      expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled(); // sin notificaciones
    });

    it('marcar un pagado y desmarcar un pendiente dan 409 y no cambian nada', async () => {
      const p = await crearAdminB2b(s.h, s.base);
      expectError(await dueno().patch(`/pedidos-b2b/${p.id}/desmarcar-pagado`), 409, 'Este pedido no está pagado');
      await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      expectError(await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`), 409, 'Este pedido ya está pagado');
    });

    it('solo Gerente y Dueño: el Operador recibe 403 (marcar, desmarcar y corregir) y no cambia nada', async () => {
      const p = await completado();
      const e = (await detalle(p.id)).entregas[0];
      expect((await gerente().patch(`/pedidos-b2b/${p.id}/marcar-pagado`)).status).toBe(200);
      expect((await operador().patch(`/pedidos-b2b/${p.id}/desmarcar-pagado`)).status).toBe(403);
      expect((await operador().patch(`/pedidos-b2b/${p.id}/entregas/${e.id}/corregir`).send(lineas([[A(), 1]]))).status).toBe(403);
      await gerente().patch(`/pedidos-b2b/${p.id}/desmarcar-pagado`).expect(200);
      expect((await operador().patch(`/pedidos-b2b/${p.id}/marcar-pagado`)).status).toBe(403);
      expect((await detalle(p.id)).estadoPago).toBe('PENDIENTE');
    });

    it('funciona en cualquier estado del pedido: Por confirmar, Confirmado, En proceso, Completado y Cancelado', async () => {
      const porConfirmar = await crearAdminB2b(s.h, s.base, { contactoTelefono: '5500000001' });
      const conf = await confirmado({ contactoTelefono: '5500000002' });
      const enProceso = await confirmado({ contactoTelefono: '5500000003' });
      await dueno().patch(`/pedidos-b2b/${enProceso.id}/entregas/${(await detalle(enProceso.id)).entregas[0].id}/cerrar`).send({ estado: 'ENTREGADA' }).expect(200);
      const comp = await completado({ contactoTelefono: '5500000004' });
      const canc = await crearAdminB2b(s.h, s.base, { contactoTelefono: '5500000005' });
      await dueno().patch(`/pedidos-b2b/${canc.id}/cancelar`).expect(200);

      const esperados = ['PENDIENTE_CONFIRMACION', 'CONFIRMADO_SURTIENDO', 'EN_PROCESO', 'COMPLETADO', 'PENDIENTE_CONFIRMACION'];
      for (const [i, p] of [porConfirmar, conf, enProceso, comp, canc].entries()) {
        await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
        const pagado = await detalle(p.id);
        expect(pagado).toMatchObject({ estadoPago: 'PAGADO', estado: esperados[i], pagadoAt: '2026-09-30T16:00:00.000Z' });
        await dueno().patch(`/pedidos-b2b/${p.id}/desmarcar-pagado`).expect(200);
        expect(await detalle(p.id)).toMatchObject({ estadoPago: 'PENDIENTE', estado: esperados[i], pagadoAt: null });
      }
      expect((await detalle(canc.id)).cancelado).toBe(true);
    });

    it('el pago nunca cambia solo: ni al corregir una entrega, ni al editar, ni al cancelar', async () => {
      const p = await confirmado();
      const [e1] = (await detalle(p.id)).entregas;
      await dueno().patch(`/pedidos-b2b/${p.id}/entregas/${e1.id}/cerrar`).send({ estado: 'ENTREGADA' }).expect(200);
      await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      const pagadoAt = (await detalle(p.id)).pagadoAt;

      await dueno().patch(`/pedidos-b2b/${p.id}/entregas/${e1.id}/corregir`).send({ estado: 'NO_RECOGIDA', ...lineas([[A(), 5]]) }).expect(200);
      expect(await detalle(p.id)).toMatchObject({ estadoPago: 'PAGADO', pagadoAt });
      await dueno().patch(`/pedidos-b2b/${p.id}/items`).send({ items: [{ productId: A(), distribucion: [{ dia: 'LUNES', cantidad: 5 }, { dia: 'MIERCOLES', cantidad: 7 }] }, { productId: B(), distribucion: [{ dia: 'VIERNES', cantidad: 4 }] }] }).expect(200);
      expect(await detalle(p.id)).toMatchObject({ estadoPago: 'PAGADO', pagadoAt });
      await dueno().patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200);
      expect(await detalle(p.id)).toMatchObject({ estadoPago: 'PAGADO', pagadoAt, cancelado: true });
    });

    it('modo AL_INICIO: marcar pagado confirma el pedido (como antes); desmarcar solo toca el pago; volver a marcar no reconfirma', async () => {
      await configurarB2b(s.h.prisma, s.base.tenant.id, { modoCobro: 'AL_INICIO' });
      const p = await crearAdminB2b(s.h, s.base);
      await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      expect(await detalle(p.id)).toMatchObject({ estadoPago: 'PAGADO', estado: 'CONFIRMADO_SURTIENDO' });
      expect(s.h.fakes.dispararSeguro).toHaveBeenCalledTimes(1);

      // DECISIÓN: desmarcar NO regresa el pedido a Por confirmar (el pago no mueve el estado hacia atrás); decide el admin.
      await dueno().patch(`/pedidos-b2b/${p.id}/desmarcar-pagado`).expect(200);
      expect(await detalle(p.id)).toMatchObject({ estadoPago: 'PENDIENTE', estado: 'CONFIRMADO_SURTIENDO', pagadoAt: null });

      // CAMBIA A PROPÓSITO: antes daba 409 "ya fue confirmado"; ahora solo marca el pago (sin revalidar mínimo ni mover estado).
      await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      expect(await detalle(p.id)).toMatchObject({ estadoPago: 'PAGADO', estado: 'CONFIRMADO_SURTIENDO' });
      expect(s.h.fakes.dispararSeguro).toHaveBeenCalledTimes(1); // sin segundo evento
    });

    it('modo AL_INICIO: un pedido cancelado que sigue Por confirmar se marca pagado SIN confirmarse', async () => {
      await configurarB2b(s.h.prisma, s.base.tenant.id, { modoCobro: 'AL_INICIO' });
      const p = await crearAdminB2b(s.h, s.base);
      await dueno().patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200);
      await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      expect(await detalle(p.id)).toMatchObject({ estadoPago: 'PAGADO', estado: 'PENDIENTE_CONFIRMACION', cancelado: true });
      expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();
    });

    it('Históricos: filtro por estado de pago en la lista y en el export', async () => {
      const a = await crearAdminB2b(s.h, s.base, { contactoTelefono: '5500000001' });
      const b = await crearAdminB2b(s.h, s.base, { contactoTelefono: '5500000002' });
      await dueno().patch(`/pedidos-b2b/${b.id}/marcar-pagado`).expect(200);
      const ids = async (qs: string) => (await dueno().get(`/pedidos-b2b?${qs}`).expect(200)).body.data.map((r: any) => r.id);
      expect(await ids('estadoPago=PAGADO')).toStrictEqual([b.id]);
      expect(await ids('estadoPago=PENDIENTE')).toStrictEqual([a.id]);
      expect((await ids('')).sort()).toStrictEqual([a.id, b.id].sort());
      const csv = (qs: string) => dueno().get(`/pedidos-b2b/export?${qs}`).expect(200).then((r) => r.text.split('\r\n').slice(1).filter(Boolean));
      expect(await csv('estadoPago=PAGADO')).toHaveLength(1);
      expect(await csv('estadoPago=PENDIENTE')).toHaveLength(1);
      expect((await dueno().get('/pedidos-b2b?estadoPago=OTRO')).status).toBe(400);
    });
  });

  describe('corrección de una entrega cerrada', () => {
    it('cambia el estado (Entregada ↔ No recogida) y las cantidades, recalcula el total y NO cambia el estado del pedido', async () => {
      const p = await completado();
      const antes = await detalle(p.id);
      const lunes = entregaDe(antes, 'LUNES');
      expect(antes).toMatchObject({ estado: 'COMPLETADO', total: '662' });

      s.h.fakes.dispararSeguro.mockClear(); // confirmar el pedido ya disparó su único evento; la corrección no debe disparar otro
      // LUNES: café 6 → 4 y pasa de Entregada a No recogida
      const res = await dueno().patch(`/pedidos-b2b/${p.id}/entregas/${lunes.id}/corregir`).send({ estado: 'NO_RECOGIDA', ...lineas([[A(), 4]]) }).expect(200);
      expect(res.body.estado).toBe('COMPLETADO'); // el estado del pedido no cambia
      expect(entregaDe(res.body, 'LUNES')).toMatchObject({ estado: 'NO_RECOGIDA', cerradaAt: lunes.cerradaAt }); // se conserva la hora del cierre original
      const cafe = res.body.items.find((i: any) => i.productId === A());
      expect(cafe).toMatchObject({ cantidadTotal: 10 }); // 4 (LUN) + 6 (MIE)
      expect(cafe.distribucion.map((d: any) => [d.dia, d.cantidad])).toStrictEqual([['LUNES', 4], ['MIERCOLES', 6]]);
      // total = 10 × $45 + 4 × $30.50 = $572 ; subtotal y descuento coherentes
      expect(res.body).toMatchObject({ subtotal: '572', descuentoTotal: '0', total: '572', totalPiezas: 14 });
      await invariante(p.id);
      expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();
    });

    it('todas las líneas toman el precio actual del catálogo y se reaplica el % de descuento del pedido', async () => {
      await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'PROMO10', porcentaje: '10.00' });
      const p = await completado({ codigoDescuento: 'PROMO10' });
      expect(await detalle(p.id)).toMatchObject({ subtotal: '662', descuentoTotal: '66.2', total: '595.8' });
      // el catálogo cambió de precio después del pedido
      await s.h.prisma.product.update({ where: { id: A() }, data: { precio: '50.00' } });
      await s.h.prisma.product.update({ where: { id: B() }, data: { precio: '40.00' } });

      // se corrige UNA entrega sin cambiar su contenido: aun así TODO el pedido se reprecia
      const lunes = entregaDe(await detalle(p.id), 'LUNES');
      const res = await dueno().patch(`/pedidos-b2b/${p.id}/entregas/${lunes.id}/corregir`).send(lineas([[A(), 6]])).expect(200);
      expect(res.body.items.map((i: any) => [i.nombreProducto, i.precioUnitario])).toStrictEqual([['Café americano', '50'], ['Concha', '40']]);
      // 12 × $50 + 4 × $40 = $760 ; −10 % = $684
      expect(res.body).toMatchObject({ subtotal: '760', descuentoTotal: '76', total: '684', descuentoPorcentajeAplicado: '10' });
    });

    it('sirve con el pedido Pagado (sigue Pagado) y con el pedido Completado', async () => {
      const p = await completado();
      await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      const e = entregaDe(await detalle(p.id), 'VIERNES');
      const res = await dueno().patch(`/pedidos-b2b/${p.id}/entregas/${e.id}/corregir`).send(lineas([[B(), 2]])).expect(200);
      expect(res.body).toMatchObject({ estadoPago: 'PAGADO', estado: 'COMPLETADO', total: '601' }); // 12 × 45 + 2 × 30.5
      expect(res.body.pagadoAt).toBe('2026-09-30T16:00:00.000Z');
    });

    it('sirve con las entregas cerradas de un pedido Cancelado; las canceladas no se tocan ni se cobran', async () => {
      const p = await confirmado();
      const d0 = await detalle(p.id);
      await dueno().patch(`/pedidos-b2b/${p.id}/entregas/${entregaDe(d0, 'LUNES').id}/cerrar`).send({ estado: 'ENTREGADA' }).expect(200);
      await dueno().patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200);
      const canc = await detalle(p.id);
      expect(canc).toMatchObject({ cancelado: true, total: '270' }); // solo la entrega cerrada se cobra

      const res = await dueno().patch(`/pedidos-b2b/${p.id}/entregas/${entregaDe(canc, 'LUNES').id}/corregir`).send(lineas([[A(), 8]])).expect(200);
      expect(res.body).toMatchObject({ cancelado: true, total: '360' }); // 8 × $45; las canceladas siguen fuera
      expect(res.body.entregas.map((e: any) => e.estado)).toStrictEqual(['ENTREGADA', 'CANCELADA', 'CANCELADA']);
      await invariante(p.id);
    });

    it('una línea nueva reutiliza el ítem del producto si ya está en el pedido; un producto que se queda sin entregas desaparece', async () => {
      const p = await completado();
      const d0 = await detalle(p.id);
      const itemB = d0.items.find((i: any) => i.productId === B()).id;

      // LUNES gana 3 Conchas (el ítem Concha ya existía por el viernes: se reutiliza)
      const r1 = await dueno().patch(`/pedidos-b2b/${p.id}/entregas/${entregaDe(d0, 'LUNES').id}/corregir`).send(lineas([[A(), 6], [B(), 3]])).expect(200);
      expect(r1.body.items.find((i: any) => i.productId === B())).toMatchObject({ id: itemB, cantidadTotal: 7 });
      expect(r1.body.items).toHaveLength(2);

      // VIERNES (única entrega con Concha además del lunes) pasa a Café: la Concha del viernes se va, la del lunes se queda
      const r2 = await dueno().patch(`/pedidos-b2b/${p.id}/entregas/${entregaDe(r1.body, 'VIERNES').id}/corregir`).send(lineas([[A(), 2]])).expect(200);
      expect(r2.body.items.find((i: any) => i.productId === B())).toMatchObject({ id: itemB, cantidadTotal: 3 });
      expect(r2.body.items.find((i: any) => i.productId === A()).cantidadTotal).toBe(14);

      // LUNES deja de llevar Concha → el ítem Concha ya no tiene ninguna entrega y se elimina
      const r3 = await dueno().patch(`/pedidos-b2b/${p.id}/entregas/${entregaDe(r2.body, 'LUNES').id}/corregir`).send(lineas([[A(), 6]])).expect(200);
      expect(r3.body.items.map((i: any) => i.productId)).toStrictEqual([A()]);
      await invariante(p.id);
      expect(r3.body.estado).toBe('COMPLETADO');
    });

    it('funciona con productos DESACTIVADOS en el catálogo (disponible = false): corregir, quitar y agregar uno desactivado', async () => {
      const p = await completado();
      await s.h.prisma.product.updateMany({ where: { id: { in: [A(), B()] } }, data: { disponible: false } });
      const d0 = await detalle(p.id);
      const lunes = entregaDe(d0, 'LUNES');
      // cambiar cantidad de una línea cuyo producto está desactivado (sigue tomando el precio del catálogo)
      const r1 = await dueno().patch(`/pedidos-b2b/${p.id}/entregas/${lunes.id}/corregir`).send({ estado: 'NO_RECOGIDA', ...lineas([[A(), 5]]) }).expect(200);
      expect(r1.body).toMatchObject({ estado: 'COMPLETADO', total: '617' }); // 11 × 45 + 4 × 30.5
      // agregar a la entrega otro producto desactivado
      const r2 = await dueno().patch(`/pedidos-b2b/${p.id}/entregas/${lunes.id}/corregir`).send(lineas([[A(), 5], [B(), 2]])).expect(200);
      expect(r2.body.items.find((i: any) => i.productId === B()).cantidadTotal).toBe(6);
      await invariante(p.id);
    });

    it('rechazos: entrega pendiente o cancelada (409), listas vacías/duplicadas/cantidad 0 (400), producto ajeno (404), entrega ajena (404)', async () => {
      const p = await confirmado();
      const d = await detalle(p.id);
      const e = d.entregas[0];
      expectError(
        await dueno().patch(`/pedidos-b2b/${p.id}/entregas/${e.id}/corregir`).send(lineas([[A(), 1]])),
        409,
        'Solo se pueden corregir entregas ya cerradas (Entregada o No recogida)',
      );
      await dueno().patch(`/pedidos-b2b/${p.id}/entregas/${e.id}/cerrar`).send({ estado: 'ENTREGADA' }).expect(200);
      const ruta = `/pedidos-b2b/${p.id}/entregas/${e.id}/corregir`;
      expect((await dueno().patch(ruta).send({ items: [] })).status).toBe(400);
      expect((await dueno().patch(ruta).send(lineas([[A(), 0]]))).status).toBe(400);
      expect((await dueno().patch(ruta).send({ estado: 'CANCELADA', ...lineas([[A(), 1]]) })).status).toBe(400); // solo Entregada / No recogida
      expectError(
        await dueno().patch(ruta).send(lineas([[A(), 1], [A(), 2]])),
        400,
        'Hay un producto repetido en la corrección — junta sus cantidades en una sola línea',
      );
      expectError(await dueno().patch(ruta).send(lineas([['00000000-0000-4000-8000-000000000000', 1]])), 404, 'Uno o más productos no existen en este negocio');
      expectError(await dueno().patch(`/pedidos-b2b/${p.id}/entregas/00000000-0000-4000-8000-000000000000/corregir`).send(lineas([[A(), 1]])), 404, 'Entrega no encontrada');

      await dueno().patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200);
      const cancelada = (await detalle(p.id)).entregas.find((x: any) => x.estado === 'CANCELADA');
      expectError(
        await dueno().patch(`/pedidos-b2b/${p.id}/entregas/${cancelada.id}/corregir`).send(lineas([[A(), 1]])),
        409,
        'Solo se pueden corregir entregas ya cerradas (Entregada o No recogida)',
      );
      // nada de lo anterior cambió la entrega cerrada
      expect((await detalle(p.id)).entregas.find((x: any) => x.id === e.id)).toMatchObject({ estado: 'ENTREGADA' });
    });
  });

  describe('edición de pedidos pagados', () => {
    it('un Gerente edita un pedido Pagado sin bloqueo y sigue Pagado', async () => {
      const p = await confirmado();
      await gerente().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      const res = await gerente()
        .patch(`/pedidos-b2b/${p.id}/items`)
        .send({ items: [{ productId: A(), distribucion: [{ dia: 'LUNES', cantidad: 6 }, { dia: 'MIERCOLES', cantidad: 6 }, { dia: 'JUEVES', cantidad: 2 }] }, { productId: B(), distribucion: [{ dia: 'VIERNES', cantidad: 4 }] }] })
        .expect(200);
      expect(res.body.estadoPago).toBe('PAGADO');
      expect(res.body.totalPiezas).toBe(18);
      expect(await detalle(p.id)).toMatchObject({ estadoPago: 'PAGADO', total: '752' }); // 14 × 45 + 4 × 30.5
    });

    it('un Operador no puede editar ni cancelar un pedido Pagado (403 sin efectos); sí confirmarlo si aplica; Gerente sí', async () => {
      const p = await confirmado();
      await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      const antes = await detalle(p.id);
      const body = { items: [{ productId: A(), distribucion: [{ dia: 'LUNES', cantidad: 6 }] }] };
      expectError(await operador().patch(`/pedidos-b2b/${p.id}/items`).send(body), 403, 'Este pedido ya está pagado — solo un administrador puede editarlo');
      expectError(await operador().patch(`/pedidos-b2b/${p.id}/cancelar`), 403, 'Este pedido ya está pagado — solo un administrador puede cancelarlo');
      expect(await detalle(p.id)).toStrictEqual(antes);
      await gerente().patch(`/pedidos-b2b/${p.id}/items`).send(body).expect(200);
    });

    it('un Operador sí edita y cancela un pedido no pagado', async () => {
      const p = await confirmado();
      await operador()
        .patch(`/pedidos-b2b/${p.id}/items`)
        .send({ items: [{ productId: A(), distribucion: [{ dia: 'LUNES', cantidad: 6 }] }] })
        .expect(200);
      expect((await operador().patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200)).body.cancelado).toBe(true);
    });

    it('la regla del Operador: un pedido Pagado le está bloqueado, a Gerente/Dueño no', () => {
      expect(puedeEditarPedidoPagado(Role.DUENO)).toBe(true);
      expect(puedeEditarPedidoPagado(Role.GERENTE)).toBe(true);
      expect(puedeEditarPedidoPagado(Role.OPERADOR)).toBe(false);
    });

    it('agregar una entrega a un pedido Completado lo regresa a En proceso (y a Pedidos activos)', async () => {
      const p = await completado();
      await dueno()
        .patch(`/pedidos-b2b/${p.id}/items`)
        .send({ items: [{ productId: A(), distribucion: [{ dia: 'LUNES', cantidad: 6 }, { dia: 'MIERCOLES', cantidad: 6 }, { dia: 'SABADO', cantidad: 3 }] }, { productId: B(), distribucion: [{ dia: 'VIERNES', cantidad: 4 }] }] })
        .expect(200);
      const d = await detalle(p.id);
      expect(d.estado).toBe('EN_PROCESO');
      expect(d.entregas.map((e: any) => e.estado)).toStrictEqual(['ENTREGADA', 'ENTREGADA', 'ENTREGADA', 'PENDIENTE']);
      const activos = (await dueno().get('/pedidos-b2b?estados=PENDIENTE_CONFIRMACION,CONFIRMADO_SURTIENDO,EN_PROCESO&cancelado=false')).body.data;
      expect(activos.map((r: any) => r.id)).toContain(p.id);
    });
  });

  void bodyB2b;
});
