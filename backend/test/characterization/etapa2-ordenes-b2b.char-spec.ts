import { expectError } from './exacto';
import { usarSuite } from './helpers';
import { apiRol, bodyB2b, crearAdminB2b, crearPublicoB2b, SEMANA_PROXIMA } from './b2b-helpers';

// Etapa 2 · comportamiento NUEVO del modelo de órdenes B2B (no es paridad con el pasado: la paridad la congelan
// etapa2-dorados y las suites b2b-*). Cubre: estado inicial, entregas, edición por diff con identidad estable,
// invariante cantidad = suma de entregas, propagación a entregas y aislamiento respecto del panel B2C.
describe('Etapa 2 · órdenes B2B sobre la orden centralizada', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B', b2b: {} } });
  const prisma = () => s.h.prisma;
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  const A = () => s.base.productoA.id;
  const B = () => s.base.productoB.id;

  const entregas = async (orderId: string) =>
    prisma().entrega.findMany({ where: { orderId }, orderBy: { fecha: 'asc' }, include: { items: true } });
  const fechaStr = (d: Date) => d.toISOString().slice(0, 10);

  /** Invariante: en B2B la cantidad de cada ítem es SIEMPRE la suma de sus EntregaItem. */
  async function invariante(orderId: string) {
    const items = await prisma().orderItem.findMany({ where: { orderId }, include: { entregaItems: true } });
    for (const item of items) {
      expect({ producto: item.nombreProducto, cantidad: item.cantidad }).toStrictEqual({
        producto: item.nombreProducto,
        cantidad: item.entregaItems.reduce((suma, ei) => suma + ei.cantidad, 0),
      });
    }
    const detalle = await prisma().detalleB2B.findUniqueOrThrow({ where: { orderId } });
    expect(detalle.totalPiezas).toBe(items.reduce((suma, i) => suma + i.cantidad, 0));
    // nunca una entrega ni un EntregaItem con cantidad 0, y a lo más una entrega por fecha (regla B2B)
    const todas = await entregas(orderId);
    expect(todas.every((e) => e.items.length > 0 && e.items.every((ei) => ei.cantidad > 0))).toBe(true);
    expect(new Set(todas.map((e) => fechaStr(e.fecha))).size).toBe(todas.length);
  }

  describe('creación', () => {
    it('nace PENDIENTE de pago, sin método de pago, tipo B2B, con su detalle y una entrega por fecha (admin y público)', async () => {
      for (const crear of [() => crearAdminB2b(s.h, s.base), () => crearPublicoB2b(s.h, s.base, { contactoTelefono: '5500000002' })]) {
        const p = await crear();
        const o = await prisma().order.findUniqueOrThrow({ where: { id: p.id }, include: { detalleB2b: true, items: true } });
        expect(o).toMatchObject({ tipo: 'B2B', estadoPago: 'PENDIENTE', estadoPedido: 'PENDIENTE_CONFIRMACION', metodoPago: null, cancelado: false, canceladoAt: null, canalOrigen: 'WEB' });
        expect(o.detalleB2b).toMatchObject({ negocioNombre: 'Cafetería La Esquina', modoCobro: 'AL_FINAL', totalPiezas: 16 });
        expect(o.items.map((i) => [i.nombreProducto, i.cantidad, i.orden])).toStrictEqual([['Café americano', 12, 0], ['Concha', 4, 1]]);
        const e = await entregas(p.id);
        // LUNES 6 + MIERCOLES 6 (café) y VIERNES 4 (concha) → 3 fechas reales de la semana destino
        expect(e.map((x) => [fechaStr(x.fecha), x.estado, x.items.reduce((n, i) => n + i.cantidad, 0)])).toStrictEqual([
          ['2026-10-05', 'PENDIENTE', 6],
          ['2026-10-07', 'PENDIENTE', 6],
          ['2026-10-09', 'PENDIENTE', 4],
        ]);
        expect(e.every((x) => x.hora === null && x.destino === null && x.nota === null && x.estadoCambiadoAt === null && x.estadoCambiadoPorId === null)).toBe(true);
        await invariante(p.id);
        expect(await prisma().detalleB2C.count()).toBe(0); // un pedido B2B no tiene detalle B2C
      }
    });

    it('cantidad 0 no crea entrega ni EntregaItem; un producto repetido se consolida en un solo OrderItem', async () => {
      const p = await crearAdminB2b(s.h, s.base, {
        items: [
          { productId: A(), distribucion: [{ dia: 'LUNES', cantidad: 5 }, { dia: 'MARTES', cantidad: 0 }, { dia: 'JUEVES', cantidad: 0 }] },
          { productId: A(), distribucion: [{ dia: 'MIERCOLES', cantidad: 3 }, { dia: 'LUNES', cantidad: 2 }] },
        ],
      });
      expect(await prisma().orderItem.count({ where: { orderId: p.id } })).toBe(1);
      const e = await entregas(p.id);
      expect(e.map((x) => [fechaStr(x.fecha), x.items.map((i) => i.cantidad)])).toStrictEqual([['2026-10-05', [7]], ['2026-10-07', [3]]]);
      expect(p.items).toHaveLength(1);
      expect(p.items[0]).toMatchObject({ cantidadTotal: 10, distribucion: [{ dia: 'LUNES', cantidad: 7 }, { dia: 'MIERCOLES', cantidad: 3 }] });
      await invariante(p.id);
    });

    it('un ítem con todas las cantidades en 0 sigue siendo 400, también si es el repetido', async () => {
      const res = await dueno().post('/pedidos-b2b', bodyB2b(s.base, {
        items: [
          { productId: A(), distribucion: [{ dia: 'LUNES', cantidad: 5 }] },
          { productId: A(), distribucion: [{ dia: 'MARTES', cantidad: 0 }] },
        ],
      }));
      expectError(res, 400, '"Café americano" no tiene ninguna cantidad asignada en la semana');
      expect(await prisma().order.count({ where: { tipo: 'B2B' } })).toBe(0);
    });
  });

  describe('edición por diff: la identidad se conserva', () => {
    it('cambiar cantidades y agregar un día actualiza/agrega lo puntual sin recrear ítems ni entregas', async () => {
      const p = await crearAdminB2b(s.h, s.base);
      const items0 = await prisma().orderItem.findMany({ where: { orderId: p.id }, orderBy: { orden: 'asc' } });
      const ent0 = await entregas(p.id);
      const ei0 = ent0.flatMap((e) => e.items);

      const res = await dueno().patch(`/pedidos-b2b/${p.id}/items`).send({
        items: [
          { productId: A(), distribucion: [{ dia: 'LUNES', cantidad: 6 }, { dia: 'MIERCOLES', cantidad: 9 }] }, // miércoles 6 → 9
          { productId: B(), distribucion: [{ dia: 'VIERNES', cantidad: 4 }, { dia: 'SABADO', cantidad: 2 }] }, // día nuevo
        ],
      });
      expect(res.status).toBe(200);

      const items1 = await prisma().orderItem.findMany({ where: { orderId: p.id }, orderBy: { orden: 'asc' } });
      expect(items1.map((i) => i.id)).toStrictEqual(items0.map((i) => i.id)); // mismos ítems
      expect(items1.map((i) => i.cantidad)).toStrictEqual([15, 6]);
      const ent1 = await entregas(p.id);
      const idPorFecha = (e: typeof ent1) => Object.fromEntries(e.map((x) => [fechaStr(x.fecha), x.id]));
      const antes = idPorFecha(ent0);
      const despues = idPorFecha(ent1);
      expect(Object.keys(despues)).toStrictEqual(['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-10']);
      for (const f of Object.keys(antes)) expect(despues[f]).toBe(antes[f]); // las 3 entregas existentes conservan su id
      // los EntregaItem que no cambiaron de fecha/ítem conservan su id (incluido el del miércoles, solo con otra cantidad)
      const ei1 = ent1.flatMap((e) => e.items);
      for (const viejo of ei0) expect(ei1.find((x) => x.id === viejo.id)).toBeDefined();
      expect(ei1.find((x) => x.id === ei0.find((x0) => x0.cantidad === 6 && fechaStr(ent0.find((e) => e.id === x0.entregaId)!.fecha) === '2026-10-07')!.id)!.cantidad).toBe(9);
      await invariante(p.id);

      // y la respuesta HTTP sigue siendo la forma plana de siempre
      expect(res.body.totalPiezas).toBe(21);
      expect(res.body.items[0].distribucion.map((d: any) => [d.dia, d.cantidad])).toStrictEqual([['LUNES', 6], ['MIERCOLES', 9]]);
    });

    it('quitar un día o un producto borra solo eso (el resto conserva su id); volver a agregarlo crea uno nuevo', async () => {
      const p = await crearAdminB2b(s.h, s.base);
      const itemA = (await prisma().orderItem.findFirstOrThrow({ where: { orderId: p.id, productId: A() } })).id;
      const itemB = (await prisma().orderItem.findFirstOrThrow({ where: { orderId: p.id, productId: B() } })).id;
      const ent0 = await entregas(p.id);
      const lunes = ent0.find((e) => fechaStr(e.fecha) === '2026-10-05')!.id;

      await dueno().patch(`/pedidos-b2b/${p.id}/items`).send({ items: [{ productId: A(), distribucion: [{ dia: 'LUNES', cantidad: 6 }] }] }).expect(200);
      expect((await prisma().orderItem.findMany({ where: { orderId: p.id } })).map((i) => i.id)).toStrictEqual([itemA]);
      const ent1 = await entregas(p.id);
      expect(ent1.map((e) => [e.id, fechaStr(e.fecha)])).toStrictEqual([[lunes, '2026-10-05']]); // miércoles y viernes se fueron
      expect(await prisma().entregaItem.count({ where: { orderItemId: itemB } })).toBe(0);
      await invariante(p.id);

      await dueno().patch(`/pedidos-b2b/${p.id}/items`).send({
        items: [
          { productId: A(), distribucion: [{ dia: 'LUNES', cantidad: 6 }] },
          { productId: B(), distribucion: [{ dia: 'VIERNES', cantidad: 4 }] },
        ],
      }).expect(200);
      const itemsDespues = await prisma().orderItem.findMany({ where: { orderId: p.id }, orderBy: { orden: 'asc' } });
      expect(itemsDespues[0].id).toBe(itemA);
      expect(itemsDespues[1].id).not.toBe(itemB); // el producto quitado y vuelto a agregar es un ítem nuevo
      expect(itemsDespues.map((i) => i.orden)).toStrictEqual([0, 1]);
      await invariante(p.id);
    });

    it('recalcula totales y conserva el porcentaje del código; mover un producto de día reubica su cantidad', async () => {
      const p = await crearAdminB2b(s.h, s.base);
      await dueno().patch(`/pedidos-b2b/${p.id}/items`).send({ items: [{ productId: B(), distribucion: [{ dia: 'JUEVES', cantidad: 10 }] }] }).expect(200);
      const o = await prisma().order.findUniqueOrThrow({ where: { id: p.id }, include: { detalleB2b: true } });
      expect({ total: String(o.total), subtotal: String(o.detalleB2b!.subtotal), piezas: o.detalleB2b!.totalPiezas }).toStrictEqual({ total: '305', subtotal: '305', piezas: 10 });
      expect((await entregas(p.id)).map((e) => fechaStr(e.fecha))).toStrictEqual(['2026-10-08']);
      await invariante(p.id);
    });

    it('defensa: no modifica una entrega que ya no está pendiente (409) y no cambia nada', async () => {
      const p = await crearAdminB2b(s.h, s.base);
      const e = (await entregas(p.id))[0];
      await prisma().entrega.update({ where: { id: e.id }, data: { estado: 'LISTA' } });
      const res = await dueno().patch(`/pedidos-b2b/${p.id}/items`).send({
        items: [
          { productId: A(), distribucion: [{ dia: 'LUNES', cantidad: 1 }, { dia: 'MIERCOLES', cantidad: 6 }] },
          { productId: B(), distribucion: [{ dia: 'VIERNES', cantidad: 4 }] },
        ],
      });
      expectError(res, 409, 'La entrega del 2026-10-05 ya no está pendiente — no se puede modificar');
      const sigue = await entregas(p.id);
      expect(sigue.find((x) => x.id === e.id)!.items.map((i) => i.cantidad)).toStrictEqual([6]); // rollback: nada cambió
      await invariante(p.id);
    });

    it('ediciones simultáneas del mismo pedido terminan consistentes (una entrega por fecha, invariante intacta)', async () => {
      const p = await crearAdminB2b(s.h, s.base);
      const edit = (n: number) =>
        dueno().patch(`/pedidos-b2b/${p.id}/items`).send({
          items: [{ productId: A(), distribucion: [{ dia: 'LUNES', cantidad: n }, { dia: 'MARTES', cantidad: n }] }],
        });
      const res = await Promise.all([edit(3), edit(4), edit(5)]);
      expect(res.map((r) => r.status)).toStrictEqual([200, 200, 200]);
      await invariante(p.id);
      expect((await entregas(p.id)).map((e) => fechaStr(e.fecha))).toStrictEqual(['2026-10-05', '2026-10-06']);
    });
  });

  describe('estado del pedido → estado de las entregas (un solo sentido, sin UI)', () => {
    it('despachar marca ENTREGADA sus entregas no canceladas, con quién y cuándo', async () => {
      const p = await crearAdminB2b(s.h, s.base);
      await dueno().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
      expect((await entregas(p.id)).every((e) => e.estado === 'PENDIENTE')).toBe(true); // confirmar no toca las entregas
      await dueno().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
      const e = await entregas(p.id);
      expect(e).toHaveLength(3);
      expect(e.every((x) => x.estado === 'ENTREGADA' && x.estadoCambiadoPorId === s.base.dueno.id && x.estadoCambiadoAt !== null)).toBe(true);
    });

    it('cancelar marca CANCELADA sus entregas no entregadas; el pedido cancelado deja de aparecer en "Pedidos del día"', async () => {
      const p = await crearAdminB2b(s.h, s.base);
      expect((await dueno().get('/pedidos-b2b/dia/2026-10-05')).body).toHaveLength(1);
      await dueno().patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200);
      const e = await entregas(p.id);
      expect(e.every((x) => x.estado === 'CANCELADA' && x.estadoCambiadoPorId === s.base.dueno.id && x.estadoCambiadoAt !== null)).toBe(true);
      expect((await dueno().get('/pedidos-b2b/dia/2026-10-05')).body).toHaveLength(0);
      const o = await prisma().order.findUniqueOrThrow({ where: { id: p.id } });
      expect(o).toMatchObject({ cancelado: true, estadoPedido: 'PENDIENTE_CONFIRMACION' }); // el estado del pedido no se toca
    });

    it('una entrega ya entregada no se cancela (el pedido despachado tampoco se puede cancelar: 409)', async () => {
      const p = await crearAdminB2b(s.h, s.base);
      await dueno().patch(`/pedidos-b2b/${p.id}/avanzar`);
      await dueno().patch(`/pedidos-b2b/${p.id}/avanzar`);
      expectError(await dueno().patch(`/pedidos-b2b/${p.id}/cancelar`), 409, 'No puedes cancelar un pedido ya despachado');
      expect((await entregas(p.id)).every((x) => x.estado === 'ENTREGADA')).toBe(true);
    });
  });

  describe('aislamiento respecto del módulo B2C', () => {
    it('un pedido B2B no es alcanzable por los endpoints de pedidos B2C (404) ni aparece en sus listados', async () => {
      const p = await crearAdminB2b(s.h, s.base);
      const api = dueno();
      expectError(await api.get(`/orders/${p.id}`), 404, 'Pedido no encontrado');
      expectError(await api.patch(`/orders/${p.id}/avanzar`), 404, 'Pedido no encontrado');
      expectError(await api.post(`/orders/${p.id}/reembolsar`), 404, 'Pedido no encontrado');
      for (const url of ['/orders', '/orders?soloPagados=true']) expect((await api.get(url)).body).toStrictEqual([]);
      expect((await api.get('/orders/historico')).body.total).toBe(0);
      // y el B2B sigue intacto
      expect((await prisma().order.findUniqueOrThrow({ where: { id: p.id } })).estadoPedido).toBe('PENDIENTE_CONFIRMACION');
    });

    it('un pedido B2B pagado NO cuenta en las métricas del Dashboard B2C', async () => {
      const p = await crearAdminB2b(s.h, s.base);
      await dueno().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      const rango = 'desde=2026-09-30T06:00:00.000Z&hasta=2026-10-01T05:59:59.999Z';
      expect((await dueno().get(`/orders/summary?${rango}`)).body).toMatchObject({ pedidosHoy: 0, ingresosHoy: '0.00' });
      const estatus = (await dueno().get(`/orders/summary/estatus?${rango}`)).body as { conteo: number }[];
      expect(estatus.every((x) => x.conteo === 0)).toBe(true);
    });

    it('las órdenes B2C no exponen las columnas nuevas (cancelado, canceladoAt, orden)', async () => {
      const { postCheckout, bodyCheckout } = await import('./helpers');
      const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
      expect(res.status).toBe(201);
      expect(res.body).not.toHaveProperty('cancelado');
      expect(res.body).not.toHaveProperty('canceladoAt');
      expect(res.body.items[0]).not.toHaveProperty('orden');
      const lista = (await dueno().get('/orders')).body;
      expect(lista[0]).not.toHaveProperty('cancelado');
      expect(lista[0].items[0]).not.toHaveProperty('orden');
    });
  });

  it('SEMANA_PROXIMA de los helpers es la semana destino (sanidad de las fechas de arriba)', () => {
    expect(SEMANA_PROXIMA).toBe('2026-10-05');
  });
});
