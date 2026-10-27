import { BaseSeed, seedBase } from './db';
import { usarSuite } from './helpers';
import {
  apiRol,
  SEMANA_ACTUAL,
  SEMANA_PROXIMA,
  SEMANA_SIGUIENTE,
} from './b2b-helpers';

// Historial de solo lectura en el panel del cliente B2B: GET /clientes-b2b/:id/pedidos (lista ligera, paginada) y
// GET /clientes-b2b/:id/pedidos/:pedidoId/entregas (entregas de UN pedido).
describe('Clientes B2B · historial de pedidos y entregas', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const admin = () => apiRol(s.h, s.base, 'GERENTE');
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  const operador = () => apiRol(s.h, s.base, 'OPERADOR');

  const alta = async (nombre = 'Café Aurora Matriz', sufijo = 'matriz') =>
    (
      await admin()
        .post('/clientes-b2b')
        .send({
          nombre,
          sufijo,
          direccion: 'Av. Siempre Viva 123',
          modalidadPago: 'AL_FINAL',
          telefonos: [{ telefono: '5511112222', principal: true }],
        })
        .expect(201)
    ).body;

  const pedir = async (
    clienteId: string,
    semanaInicio: string,
    dias: [string, number][] = [['LUNES', 6], ['MIERCOLES', 4]],
  ) =>
    (
      await admin()
        .post('/pedidos-b2b')
        .send({
          clienteId,
          semanaInicio,
          items: [
            {
              productId: s.base.productoA.id,
              distribucion: dias.map(([dia, cantidad]) => ({ dia, cantidad })),
            },
          ],
        })
        .expect(201)
    ).body;

  const lista = (id: string, qs = '', api = admin()) =>
    api.get(`/clientes-b2b/${id}/pedidos${qs}`);
  const entregas = (id: string, pid: string, api = admin()) =>
    api.get(`/clientes-b2b/${id}/pedidos/${pid}/entregas`);

  it('cliente sin pedidos: lista vacía, sin error', async () => {
    const c = await alta();
    const r = await lista(c.id).expect(200);
    expect(r.body).toMatchObject({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 });
  });

  it('lista TODOS los pedidos (cancelados y cualquier pago), semana más reciente primero, forma ligera', async () => {
    const c = await alta();
    const p1 = await pedir(c.id, SEMANA_PROXIMA);
    const p2 = await pedir(c.id, SEMANA_SIGUIENTE, [['MARTES', 3]]);
    await admin().patch(`/pedidos-b2b/${p2.id}/cancelar`).expect(200);

    const r = (await lista(c.id).expect(200)).body;
    expect(r.total).toBe(2);
    expect(r.data.map((p: any) => p.folio)).toStrictEqual([p2.folio, p1.folio]);
    expect(r.data[0]).toStrictEqual({
      id: p2.id,
      folio: p2.folio,
      semanaInicio: expect.stringContaining(SEMANA_SIGUIENTE),
      estado: 'PENDIENTE_CONFIRMACION',
      estadoPago: 'PENDIENTE',
      cancelado: true,
      canceladoAt: expect.any(String),
      totalPiezas: 3,
      total: expect.any(String),
      createdAt: expect.any(String),
    });
    expect(r.data[1]).toMatchObject({ cancelado: false, totalPiezas: 10, total: '450' });
    // Lista ligera: nada de ítems ni entregas.
    expect(r.data[0]).not.toHaveProperty('items');
    expect(r.data[0]).not.toHaveProperty('entregas');
  });

  it('un cliente de baja conserva su historial; los contadores no cambian por la lista', async () => {
    const c = await alta();
    await pedir(c.id, SEMANA_PROXIMA);
    await admin().post(`/clientes-b2b/${c.id}/baja`).expect(201);
    expect((await lista(c.id).expect(200)).body.total).toBe(1);
  });

  it('un DESPACHADO heredado se ve como COMPLETADO', async () => {
    const c = await alta();
    const p = await pedir(c.id, SEMANA_PROXIMA);
    await s.h.prisma.order.update({ where: { id: p.id }, data: { estadoPedido: 'DESPACHADO' } });
    expect((await lista(c.id).expect(200)).body.data[0].estado).toBe('COMPLETADO');
  });

  it('pagina de a limit con orden estable (Cargar más)', async () => {
    const c = await alta();
    const p1 = await pedir(c.id, SEMANA_PROXIMA);
    const p2 = await pedir(c.id, SEMANA_SIGUIENTE);
    const pag1 = (await lista(c.id, '?limit=1&page=1').expect(200)).body;
    const pag2 = (await lista(c.id, '?limit=1&page=2').expect(200)).body;
    expect([pag1.data[0].id, pag2.data[0].id]).toStrictEqual([p2.id, p1.id]);
    expect(pag1).toMatchObject({ total: 2, totalPages: 2 });
    expect((await lista(c.id, '?limit=101')).status).toBe(400);
  });

  it('solo los pedidos de ESE cliente', async () => {
    const a = await alta();
    const b = await alta('Otro Café', 'otro');
    await pedir(a.id, SEMANA_PROXIMA);
    expect((await lista(b.id).expect(200)).body.total).toBe(0);
  });

  describe('entregas de un pedido', () => {
    it('día, fecha, estado, atrasada y productos con cantidad y precio unitario', async () => {
      const c = await alta();
      const p = await pedir(c.id, SEMANA_ACTUAL, [['LUNES', 6], ['VIERNES', 4]]);
      const r = (await entregas(c.id, p.id).expect(200)).body;
      expect(r.entregas).toHaveLength(2);
      expect(r.entregas[0]).toStrictEqual({
        id: expect.any(String),
        fecha: expect.stringContaining('2026-09-28'),
        dia: 'LUNES',
        estado: 'PENDIENTE',
        cerradaAt: null,
        atrasada: true, // lunes 28 < hoy (miércoles 30), sigue pendiente
        productos: [{ nombreProducto: expect.any(String), precioUnitario: '45', cantidad: 6 }],
      });
      expect(r.entregas[1]).toMatchObject({ dia: 'VIERNES', atrasada: false, productos: [{ cantidad: 4 }] });
      expect(r.entregas[1].productos[0]).toMatchObject({ precioUnitario: '45', cantidad: 4 });
    });

    it('pedido cancelado: muestra el estado real (cerradas conservadas, pendientes canceladas)', async () => {
      const c = await alta();
      const p = await pedir(c.id, SEMANA_ACTUAL, [['LUNES', 6], ['VIERNES', 4]]);
      await admin().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
      const det = (await admin().get(`/pedidos-b2b/${p.id}`).expect(200)).body;
      await admin()
        .patch(`/pedidos-b2b/${p.id}/entregas/${det.entregas[0].id}/cerrar`)
        .send({ estado: 'ENTREGADA' })
        .expect(200);
      await admin().patch(`/pedidos-b2b/${p.id}/cancelar`).expect(200);
      const r = (await entregas(c.id, p.id).expect(200)).body;
      expect(r.entregas.map((e: any) => [e.dia, e.estado, e.atrasada])).toStrictEqual([
        ['LUNES', 'ENTREGADA', false],
        ['VIERNES', 'CANCELADA', false],
      ]);
      expect(r.entregas[0].cerradaAt).toEqual(expect.any(String));
    });

    it('pedido sin entregas: lista vacía', async () => {
      const c = await alta();
      const p = await pedir(c.id, SEMANA_PROXIMA);
      await s.h.prisma.entrega.deleteMany({ where: { orderId: p.id } });
      expect((await entregas(c.id, p.id).expect(200)).body).toStrictEqual({ entregas: [] });
    });

    it('un pedido de otro cliente, inexistente o B2C da 404', async () => {
      const a = await alta();
      const b = await alta('Otro Café', 'otro');
      const p = await pedir(a.id, SEMANA_PROXIMA);
      expect((await entregas(b.id, p.id)).status).toBe(404);
      expect((await entregas(a.id, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
    });
  });

  describe('permisos y aislamiento', () => {
    it('Gerente y Dueño leen; Operador recibe 403 en ambos endpoints', async () => {
      const c = await alta();
      const p = await pedir(c.id, SEMANA_PROXIMA);
      expect((await lista(c.id, '', dueno())).status).toBe(200);
      expect((await entregas(c.id, p.id, dueno())).status).toBe(200);
      expect((await lista(c.id, '', operador())).status).toBe(403);
      expect((await entregas(c.id, p.id, operador())).status).toBe(403);
    });

    it('un cliente de otro tenant da 404 (igual que uno inexistente)', async () => {
      const c = await alta();
      const p = await pedir(c.id, SEMANA_PROXIMA);
      const otro: BaseSeed = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
      const apiOtro = apiRol(s.h, otro, 'DUENO');
      expect((await lista(c.id, '', apiOtro)).status).toBe(404);
      expect((await entregas(c.id, p.id, apiOtro)).status).toBe(404);
    });
  });

  describe('GET /pedidos-b2b: orden del listado (Históricos y Pedidos activos)', () => {
    it('semana más reciente primero; dentro de la misma semana, el pedido más nuevo primero', async () => {
      const a = await alta('Café A', 'a');
      const b = await alta('Café B', 'b');
      const c = await alta('Café C', 'c');
      jest.setSystemTime(new Date('2026-09-30T16:00:00.000Z'));
      const viejoSemana1 = await pedir(a.id, SEMANA_PROXIMA);
      jest.setSystemTime(new Date('2026-09-30T17:00:00.000Z'));
      const nuevoSemana1 = await pedir(b.id, SEMANA_PROXIMA);
      jest.setSystemTime(new Date('2026-09-30T15:00:00.000Z')); // creado ANTES, pero de una semana posterior
      const semana2 = await pedir(c.id, SEMANA_SIGUIENTE);
      const r = (await admin().get('/pedidos-b2b?limit=10').expect(200)).body;
      expect(r.data.map((p: any) => p.id)).toStrictEqual([semana2.id, nuevoSemana1.id, viejoSemana1.id]);
    });
  });
});
