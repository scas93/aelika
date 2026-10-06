import { configurarB2b, seedBase, seedCodigoDescuento } from './db';
import { expectError, expectExacto } from './exacto';
import { cederEventLoop, usarSuite } from './helpers';
import { normalizar } from './normalizar';
import {
  apiRol,
  crearAdminB2b,
  crearPublicoB2b,
  diaEsperado,
  etiquetasB2b,
  itemB2bEsperado,
  pedidoB2bEsperado,
} from './b2b-helpers';

// 0b-1 · Área 7 · Mutaciones B2B: updateItems, avanzar, marcarPagado, cancelar y sus cruces, más el contexto
// de reglas PEDIDO_B2B que recibe dispararSeguro (o que no se dispara).
describe('B2B · mutaciones', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const api = () => apiRol(s.h, s.base, 'DUENO');
  const exacto = (body: any, esperado: unknown, extra: Record<string, string> = {}) =>
    expectExacto(body, esperado, etiquetasB2b(s.base, body, extra));
  const pedidoConPiezas = (piezas: number, extra: Record<string, unknown> = {}) =>
    crearPublicoB2b(s.h, s.base, {
      items: [{ productId: s.base.productoB.id, distribucion: [{ dia: 'VIERNES', cantidad: piezas }] }],
      ...extra,
    });

  /** Contexto exacto que recibe dispararSeguro para PEDIDO_B2B (sin campos de menudeo). */
  const contextoRegla = (call: any, pedido: { clienteId: string }) =>
    normalizar(call, { [s.base.tenant.id]: 'tenant', [pedido.clienteId]: 'cliente' });

  describe('PATCH /pedidos-b2b/:id/items', () => {
    const nuevos = [{ productId: '', distribucion: [{ dia: 'LUNES', cantidad: 5 }, { dia: 'MARTES', cantidad: 5 }] }];
    const cuerpo = () => ({ items: [{ ...nuevos[0], productId: s.base.productoB.id }] });

    it('reemplaza los items (borra los anteriores), recalcula piezas y totales; sin notificaciones', async () => {
      const p = await crearPublicoB2b(s.h, s.base);
      const res = await api().patch(`/pedidos-b2b/${p.id}/items`).send(cuerpo());
      expect(res.status).toBe(200);
      exacto(
        res.body,
        pedidoB2bEsperado({
          totalPiezas: 10,
          subtotal: '305',
          total: '305',
          items: [
            itemB2bEsperado(
              {
                productId: '<productoB>',
                nombreProducto: 'Concha',
                precioUnitario: '30.5',
                cantidadTotal: 10,
                distribucion: [diaEsperado('LUNES', 5, 0), diaEsperado('MARTES', 5, 0)],
              },
              0,
            ),
          ],
        }),
      );
      expect(await s.h.prisma.orderItem.count({ where: { order: { tipo: 'B2B' } } })).toBe(1);
      expect(await s.h.prisma.entregaItem.count()).toBe(2); // Etapa 2: los días son EntregaItem
      await cederEventLoop();
      expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();
      expect(s.h.fakes.queueAdd).not.toHaveBeenCalled();
    });

    it('conserva el porcentaje de descuento del código ya aplicado y recalcula el descuento', async () => {
      const codigo = await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'PROMO10', porcentaje: '10.00' });
      const p = await crearPublicoB2b(s.h, s.base, { codigoDescuento: 'PROMO10' });
      const res = await api().patch(`/pedidos-b2b/${p.id}/items`).send(cuerpo()).expect(200);
      // 305 − 10% (30.5) = 274.5
      exacto(
        res.body,
        pedidoB2bEsperado({
          totalPiezas: 10,
          codigoDescuentoId: '<codigo>',
          codigoDescuentoTexto: 'PROMO10',
          descuentoPorcentajeAplicado: '10',
          subtotal: '305',
          descuentoTotal: '30.5',
          total: '274.5',
          items: [
            itemB2bEsperado(
              {
                productId: '<productoB>',
                nombreProducto: 'Concha',
                precioUnitario: '30.5',
                cantidadTotal: 10,
                distribucion: [diaEsperado('LUNES', 5, 0), diaEsperado('MARTES', 5, 0)],
              },
              0,
            ),
          ],
        }),
        { [codigo.id]: 'codigo' },
      );
    });

    it('un pedido CONFIRMADO_SURTIENDO (sin pagar) sí se puede editar; y no se revalida el mínimo de piezas', async () => {
      const p = await crearPublicoB2b(s.h, s.base);
      await api().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
      const res = await api()
        .patch(`/pedidos-b2b/${p.id}/items`)
        .send({ items: [{ productId: s.base.productoB.id, distribucion: [{ dia: 'LUNES', cantidad: 1 }] }] })
        .expect(200);
      expect({ estado: res.body.estado, totalPiezas: res.body.totalPiezas, minimo: res.body.minimoPiezasAplicado }).toStrictEqual({
        estado: 'CONFIRMADO_SURTIENDO',
        totalPiezas: 1,
        minimo: 10,
      });
    });

    it('rechazos: cancelado, despachado, pagado, id inexistente', async () => {
      const cancelado = await crearPublicoB2b(s.h, s.base);
      await api().patch(`/pedidos-b2b/${cancelado.id}/cancelar`).expect(200);
      expectError(await api().patch(`/pedidos-b2b/${cancelado.id}/items`).send(cuerpo()), 409, 'Este pedido está cancelado');

      const despachado = await crearPublicoB2b(s.h, s.base, { contactoTelefono: '5500000001' });
      await api().patch(`/pedidos-b2b/${despachado.id}/avanzar`).expect(200);
      await api().patch(`/pedidos-b2b/${despachado.id}/avanzar`).expect(200);
      expectError(await api().patch(`/pedidos-b2b/${despachado.id}/items`).send(cuerpo()), 409, 'No puedes editar un pedido ya despachado');

      const pagado = await crearPublicoB2b(s.h, s.base, { contactoTelefono: '5500000002' });
      await api().patch(`/pedidos-b2b/${pagado.id}/marcar-pagado`).expect(200);
      expectError(
        await api().patch(`/pedidos-b2b/${pagado.id}/items`).send(cuerpo()),
        409,
        'Este pedido ya está pagado — crea un pedido nuevo para agregar más producto',
      );
      expectError(await api().patch('/pedidos-b2b/00000000-0000-4000-8000-000000000000/items').send(cuerpo()), 404, 'Pedido no encontrado');
    });

    it('validación de items: vacío, día repetido, producto de otro tenant, cantidad total 0', async () => {
      const p = await crearPublicoB2b(s.h, s.base);
      expectError(await api().patch(`/pedidos-b2b/${p.id}/items`).send({ items: [] }), 400, ['items must contain at least 1 elements']);
      expectError(
        await api()
          .patch(`/pedidos-b2b/${p.id}/items`)
          .send({ items: [{ productId: s.base.productoA.id, distribucion: [{ dia: 'LUNES', cantidad: 1 }, { dia: 'LUNES', cantidad: 2 }] }] }),
        400,
        'El día "LUNES" está repetido para "Café americano"',
      );
      const otro = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
      expectError(
        await api().patch(`/pedidos-b2b/${p.id}/items`).send({ items: [{ productId: otro.productoA.id, distribucion: [{ dia: 'LUNES', cantidad: 5 }] }] }),
        404,
        'Uno o más productos no existen en este negocio',
      );
      expectError(
        await api().patch(`/pedidos-b2b/${p.id}/items`).send({ items: [{ productId: s.base.productoA.id, distribucion: [{ dia: 'LUNES', cantidad: 0 }] }] }),
        400,
        '"Café americano" no tiene ninguna cantidad asignada en la semana',
      );
      // el pedido original quedó intacto
      expect(await s.h.prisma.orderItem.count({ where: { order: { tipo: 'B2B' } } })).toBe(2);
    });
  });

  describe('PATCH /pedidos-b2b/:id/avanzar', () => {
    it('AL_FINAL: PENDIENTE → CONFIRMADO → DESPACHADO → 409; cada paso dispara la regla PEDIDO_B2B con su contexto exacto', async () => {
      const p = await crearPublicoB2b(s.h, s.base);

      const r1 = await api().patch(`/pedidos-b2b/${p.id}/avanzar`);
      expect(r1.status).toBe(200);
      exacto(r1.body, pedidoB2bEsperado({ estado: 'CONFIRMADO_SURTIENDO' }));
      expect(contextoRegla(s.h.fakes.dispararSeguro.mock.calls[0][0], p)).toStrictEqual({
        tenantId: '<tenant>',
        origen: 'PEDIDO_B2B',
        estatus: 'CONFIRMADO_SURTIENDO',
        clienteId: '<cliente>',
        contexto: {
          origen: 'PEDIDO_B2B',
          folio: '1',
          total: '662',
          estatus: 'CONFIRMADO_SURTIENDO',
          createdAt: '<iso>',
          items: [
            { nombreProducto: 'Café americano', cantidad: 12 },
            { nombreProducto: 'Concha', cantidad: 4 },
          ],
        },
      });

      const r2 = await api().patch(`/pedidos-b2b/${p.id}/avanzar`);
      expect(r2.status).toBe(200);
      exacto(r2.body, pedidoB2bEsperado({ estado: 'DESPACHADO' }));
      expect(s.h.fakes.dispararSeguro.mock.calls[1][0]).toMatchObject({ origen: 'PEDIDO_B2B', estatus: 'DESPACHADO' });

      expectError(await api().patch(`/pedidos-b2b/${p.id}/avanzar`), 409, 'Este pedido ya está despachado');
      expect(s.h.fakes.dispararSeguro).toHaveBeenCalledTimes(2);
      await cederEventLoop();
      expect(s.h.fakes.queueAdd).not.toHaveBeenCalled(); // B2B nunca encola notificaciones de evento
    });

    it('rechaza confirmar por debajo del mínimo de piezas (409 con cuántas tiene) y no dispara nada', async () => {
      const p = await pedidoConPiezas(4);
      expectError(await api().patch(`/pedidos-b2b/${p.id}/avanzar`), 409, 'Este pedido no alcanza el mínimo de 10 piezas (tiene 4)');
      expect((await s.h.prisma.order.findUniqueOrThrow({ where: { id: p.id } })).estadoPedido).toBe('PENDIENTE_CONFIRMACION');
      expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();
    });

    it('con exactamente el mínimo (10) sí confirma', async () => {
      const p = await pedidoConPiezas(10);
      await api().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
    });

    it('usa el mínimo guardado en el pedido (snapshot), no el actual del tenant', async () => {
      const p = await pedidoConPiezas(12);
      await configurarB2b(s.h.prisma, s.base.tenant.id, { minimoPiezas: 100 });
      await api().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
    });

    it('CONGELADO: en AL_FINAL se puede despachar sin haber pagado', async () => {
      const p = await crearPublicoB2b(s.h, s.base);
      await api().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
      const res = await api().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
      expect({ estado: res.body.estado, estadoPago: res.body.estadoPago }).toStrictEqual({ estado: 'DESPACHADO', estadoPago: 'PENDIENTE' });
    });

    it('AL_INICIO: no se confirma con avanzar (409 apunta a marcar-pagado); tras pagar se puede despachar', async () => {
      await configurarB2b(s.h.prisma, s.base.tenant.id, { modoCobro: 'AL_INICIO' });
      const p = await crearAdminB2b(s.h, s.base);
      expectError(
        await api().patch(`/pedidos-b2b/${p.id}/avanzar`),
        409,
        'Este pedido requiere pago para confirmarse — usa /pedidos-b2b/:id/marcar-pagado',
      );
      expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();
      await api().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      s.h.fakes.dispararSeguro.mockClear();
      const res = await api().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
      expect(res.body.estado).toBe('DESPACHADO');
      expect(s.h.fakes.dispararSeguro).toHaveBeenCalledTimes(1);
    });

    it('id inexistente: 404', async () => {
      expectError(await api().patch('/pedidos-b2b/00000000-0000-4000-8000-000000000000/avanzar'), 404, 'Pedido no encontrado');
    });
  });

  describe('PATCH /pedidos-b2b/:id/marcar-pagado', () => {
    it('AL_FINAL: solo cambia estadoPago (el estado no se toca) y NO dispara la regla', async () => {
      const p = await crearPublicoB2b(s.h, s.base);
      const res = await api().patch(`/pedidos-b2b/${p.id}/marcar-pagado`);
      expect(res.status).toBe(200);
      exacto(res.body, pedidoB2bEsperado({ estadoPago: 'PAGADO' }));
      expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();
      expectError(await api().patch(`/pedidos-b2b/${p.id}/marcar-pagado`), 409, 'Este pedido ya está pagado');
    });

    it('CONGELADO: en AL_FINAL no se valida el mínimo de piezas y se puede pagar aun despachado', async () => {
      const poca = await pedidoConPiezas(4);
      await api().patch(`/pedidos-b2b/${poca.id}/marcar-pagado`).expect(200);
      const p = await crearPublicoB2b(s.h, s.base, { contactoTelefono: '5500000001' });
      await api().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
      await api().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
      const res = await api().patch(`/pedidos-b2b/${p.id}/marcar-pagado`).expect(200);
      expect({ estado: res.body.estado, estadoPago: res.body.estadoPago }).toStrictEqual({ estado: 'DESPACHADO', estadoPago: 'PAGADO' });
    });

    it('AL_INICIO: paga, confirma en el mismo paso y dispara la regla con estatus CONFIRMADO_SURTIENDO', async () => {
      await configurarB2b(s.h.prisma, s.base.tenant.id, { modoCobro: 'AL_INICIO' });
      const p = await crearAdminB2b(s.h, s.base);
      const res = await api().patch(`/pedidos-b2b/${p.id}/marcar-pagado`);
      expect(res.status).toBe(200);
      exacto(res.body, pedidoB2bEsperado({ modoCobro: 'AL_INICIO', estado: 'CONFIRMADO_SURTIENDO', estadoPago: 'PAGADO' }));
      expect(s.h.fakes.dispararSeguro).toHaveBeenCalledTimes(1);
      expect(contextoRegla(s.h.fakes.dispararSeguro.mock.calls[0][0], p)).toStrictEqual({
        tenantId: '<tenant>',
        origen: 'PEDIDO_B2B',
        estatus: 'CONFIRMADO_SURTIENDO',
        clienteId: '<cliente>',
        contexto: {
          origen: 'PEDIDO_B2B',
          folio: '1',
          total: '662',
          estatus: 'CONFIRMADO_SURTIENDO',
          createdAt: '<iso>',
          items: [
            { nombreProducto: 'Café americano', cantidad: 12 },
            { nombreProducto: 'Concha', cantidad: 4 },
          ],
        },
      });
    });

    it('AL_INICIO por debajo del mínimo: 409 y no cambia nada (ni pago ni estado ni regla)', async () => {
      await configurarB2b(s.h.prisma, s.base.tenant.id, { modoCobro: 'AL_INICIO' });
      const p = await crearAdminB2b(s.h, s.base, {
        items: [{ productId: s.base.productoB.id, distribucion: [{ dia: 'VIERNES', cantidad: 4 }] }],
      });
      expectError(
        await api().patch(`/pedidos-b2b/${p.id}/marcar-pagado`),
        409,
        'Este pedido no alcanza el mínimo de 10 piezas para procesar el pago (tiene 4)',
      );
      const fila = await s.h.prisma.order.findUniqueOrThrow({ where: { id: p.id } });
      expect({ estado: fila.estadoPedido, estadoPago: fila.estadoPago }).toStrictEqual({ estado: 'PENDIENTE_CONFIRMACION', estadoPago: 'PENDIENTE' });
      expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();
    });

    it('id inexistente: 404', async () => {
      expectError(await api().patch('/pedidos-b2b/00000000-0000-4000-8000-000000000000/marcar-pagado'), 404, 'Pedido no encontrado');
    });
  });

  describe('PATCH /pedidos-b2b/:id/cancelar', () => {
    // A2 (cambia a propósito): cancelar un pedido B2B ya recalcula al Cliente — deja de contarlo.
    it('marca cancelado + canceladoAt, NO toca `estado`, no dispara reglas y el Cliente deja de contarlo (totalPedidos 0)', async () => {
      const p = await crearPublicoB2b(s.h, s.base);
      jest.setSystemTime(new Date('2026-09-30T18:30:00.000Z'));
      const res = await api().patch(`/pedidos-b2b/${p.id}/cancelar`);
      expect(res.status).toBe(200);
      exacto(res.body, pedidoB2bEsperado({ cancelado: true, canceladoAt: '<iso>' }));
      expect(res.body.canceladoAt).toBe('2026-09-30T18:30:00.000Z');
      await cederEventLoop();
      expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();
      expect(s.h.fakes.queueAdd).not.toHaveBeenCalled();
      // A2: cancelar recalcula — sin pedidos contables, totalPedidos 0 y fechas = fecha de alta.
      const cliente = (await s.h.prisma.cliente.findMany())[0];
      expect(cliente.totalPedidos).toBe(0);
      expect(cliente.primerPedidoAt).toStrictEqual(cliente.createdAt);
      expect(cliente.ultimoPedidoAt).toStrictEqual(cliente.createdAt);
    });

    it('rechazos: ya cancelado, ya despachado, id inexistente', async () => {
      const p = await crearPublicoB2b(s.h, s.base);
      await api().patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200);
      expectError(await api().patch(`/pedidos-b2b/${p.id}/cancelar`), 409, 'Este pedido ya está cancelado');

      const d = await crearPublicoB2b(s.h, s.base, { contactoTelefono: '5500000001' });
      await api().patch(`/pedidos-b2b/${d.id}/avanzar`).expect(200);
      await api().patch(`/pedidos-b2b/${d.id}/avanzar`).expect(200);
      expectError(await api().patch(`/pedidos-b2b/${d.id}/cancelar`), 409, 'No puedes cancelar un pedido ya despachado');
      expectError(await api().patch('/pedidos-b2b/00000000-0000-4000-8000-000000000000/cancelar'), 404, 'Pedido no encontrado');
    });

    it('se puede cancelar un pedido CONFIRMADO_SURTIENDO y uno PAGADO (congelado)', async () => {
      const a = await crearPublicoB2b(s.h, s.base);
      await api().patch(`/pedidos-b2b/${a.id}/avanzar`).expect(200);
      await api().patch(`/pedidos-b2b/${a.id}/cancelar`).expect(200);
      const b = await crearPublicoB2b(s.h, s.base, { contactoTelefono: '5500000001' });
      await api().patch(`/pedidos-b2b/${b.id}/marcar-pagado`).expect(200);
      const res = await api().patch(`/pedidos-b2b/${b.id}/cancelar`).expect(200);
      expect({ cancelado: res.body.cancelado, estadoPago: res.body.estadoPago }).toStrictEqual({ cancelado: true, estadoPago: 'PAGADO' });
    });

    it('un pedido cancelado no se puede avanzar, editar ni marcar como pagado (409 "está cancelado")', async () => {
      const p = await crearPublicoB2b(s.h, s.base);
      await api().patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200);
      expectError(await api().patch(`/pedidos-b2b/${p.id}/avanzar`), 409, 'Este pedido está cancelado');
      expectError(await api().patch(`/pedidos-b2b/${p.id}/marcar-pagado`), 409, 'Este pedido está cancelado');
      expectError(
        await api().patch(`/pedidos-b2b/${p.id}/items`).send({ items: [{ productId: s.base.productoB.id, distribucion: [{ dia: 'LUNES', cantidad: 5 }] }] }),
        409,
        'Este pedido está cancelado',
      );
      expect(s.h.fakes.dispararSeguro).not.toHaveBeenCalled();
    });
  });
});
