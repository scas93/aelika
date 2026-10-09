import { BaseSeed, seedBase } from './db';
import { usarSuite } from './helpers';
import { apiRol, crearPublicoB2b } from './b2b-helpers';

// Entrega 2c · API /clientes-b2b (alta, edición, teléfonos, baja, selector) y GET /clientes?canal=.
describe('Clientes B2B · API', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const admin = () => apiRol(s.h, s.base, 'GERENTE');
  const operador = () => apiRol(s.h, s.base, 'OPERADOR');
  const body = (extra: Record<string, unknown> = {}) => ({
    nombre: 'Café Aurora Matriz',
    sufijo: 'matriz',
    direccion: 'Av. Siempre Viva 123',
    telefonos: [
      {
        telefono: '+52 55 1111 2222',
        principal: true,
        nombreContacto: 'Mariana',
      },
      { telefono: '5533334444' },
    ],
    ...extra,
  });
  const alta = async (extra: Record<string, unknown> = {}) =>
    (await admin().post('/clientes-b2b').send(body(extra)).expect(201)).body;

  describe('alta', () => {
    it('crea con código {slug}-{sufijo}, dos teléfonos normalizados y uno principal', async () => {
      const c = await alta({
        descuentoPorcentaje: 10,
        modalidadPago: 'AL_INICIO',
      });
      expect(c).toMatchObject({
        codigo: 'cafe-test-matriz',
        nombre: 'Café Aurora Matriz',
        direccion: 'Av. Siempre Viva 123',
        descuentoPorcentaje: 10,
        modalidadPago: 'AL_INICIO',
        activo: true,
        incompleto: false,
        pedidosActivos: 0,
      });
      expect(
        c.telefonos.map((t: any) => [
          t.telefono,
          t.principal,
          t.nombreContacto,
        ]),
      ).toEqual([
        ['5511112222', true, 'Mariana'],
        ['5533334444', false, null],
      ]);
      // Sin Cliente.telefono en B2B y contadores en 0.
      const fila = await s.h.prisma.cliente.findUniqueOrThrow({
        where: { id: c.id },
      });
      expect(fila).toMatchObject({
        canal: 'B2B',
        telefono: null,
        totalPedidos: 0,
      });
    });

    it('sin principal marcado, el primero lo es; el sufijo se pasa a minúsculas', async () => {
      const c = await alta({
        sufijo: 'Americas-Sur',
        telefonos: [{ telefono: '5511112222' }, { telefono: '5533334444' }],
      });
      expect(c.codigo).toBe('cafe-test-americas-sur');
      expect(
        c.telefonos.filter((t: any) => t.principal).map((t: any) => t.telefono),
      ).toEqual(['5511112222']);
    });

    it('código repetido: 409', async () => {
      await alta();
      const r = await admin()
        .post('/clientes-b2b')
        .send(
          body({ nombre: 'Otro', telefonos: [{ telefono: '5599990000' }] }),
        );
      expect(r.status).toBe(409);
    });

    it('validaciones: sufijo inválido, sin dirección, sin teléfonos, dos principales, descuento fuera de rango', async () => {
      for (const extra of [
        { sufijo: 'con espacio' },
        { sufijo: 'acentó' },
        { direccion: undefined },
        { nombre: undefined },
        { telefonos: [] },
        {
          telefonos: [
            { telefono: '5511112222', principal: true },
            { telefono: '5533334444', principal: true },
          ],
        },
        {
          telefonos: [{ telefono: '5511112222' }, { telefono: '55 1111 2222' }],
        },
        { descuentoPorcentaje: 101 },
        { descuentoPorcentaje: -1 },
        { modalidadPago: 'NUNCA' },
      ]) {
        expect(
          (await admin().post('/clientes-b2b').send(body(extra))).status,
        ).toBe(400);
      }
      expect(await s.h.prisma.cliente.count()).toBe(0);
    });

    it('el mismo teléfono puede estar en varios clientes del mismo negocio', async () => {
      await alta();
      const otro = await alta({
        sufijo: 'norte',
        nombre: 'Norte',
        telefonos: [{ telefono: '5511112222' }],
      });
      expect(otro.telefonos[0].telefono).toBe('5511112222');
      expect(
        await s.h.prisma.clienteTelefono.count({
          where: { telefono: '5511112222' },
        }),
      ).toBe(2);
    });
  });

  describe('permisos y tipo de negocio', () => {
    it('el Operador recibe 403 en todo salvo el selector; sin token 401', async () => {
      const c = await alta();
      const op = operador();
      expect((await op.get('/clientes-b2b')).status).toBe(403);
      expect(
        (await op.post('/clientes-b2b').send(body({ sufijo: 'x' }))).status,
      ).toBe(403);
      expect((await op.get(`/clientes-b2b/${c.id}`)).status).toBe(403);
      expect(
        (await op.patch(`/clientes-b2b/${c.id}`).send({ nombre: 'Z' })).status,
      ).toBe(403);
      expect((await op.post(`/clientes-b2b/${c.id}/baja`)).status).toBe(403);
      expect(
        (
          await op
            .post(`/clientes-b2b/${c.id}/telefonos`)
            .send({ telefono: '5500000000' })
        ).status,
      ).toBe(403);
      expect((await op.get('/clientes-b2b/selector')).status).toBe(200);
      expect(
        (await s.h.prisma.cliente.findUniqueOrThrow({ where: { id: c.id } }))
          .nombre,
      ).toBe('Café Aurora Matriz');
      const request = (await import('supertest')).default;
      expect(
        (await request(s.h.app.getHttpServer()).get('/clientes-b2b')).status,
      ).toBe(401);
    });

    it('un negocio que no es de mayoreo recibe 403', async () => {
      const b2c = await seedBase(s.h.prisma, {
        slug: 'menudeo',
        tipoStorefront: 'RETAIL_B2C',
      });
      expect(
        (await apiRol(s.h, b2c, 'DUENO').get('/clientes-b2b')).status,
      ).toBe(403);
      expect(
        (await apiRol(s.h, b2c, 'OPERADOR').get('/clientes-b2b/selector'))
          .status,
      ).toBe(403);
    });
  });

  describe('edición', () => {
    it('edita todo menos el código (un codigo en el body se ignora); null borra descuento y modalidad', async () => {
      const c = await alta({
        descuentoPorcentaje: 20,
        modalidadPago: 'AL_INICIO',
      });
      const r = await admin()
        .patch(`/clientes-b2b/${c.id}`)
        .send({
          nombre: 'Nuevo nombre',
          direccion: 'Otra calle 5',
          codigo: 'hackeado',
          descuentoPorcentaje: 15,
        })
        .expect(200);
      expect(r.body).toMatchObject({
        codigo: 'cafe-test-matriz',
        nombre: 'Nuevo nombre',
        direccion: 'Otra calle 5',
        descuentoPorcentaje: 15,
        modalidadPago: 'AL_INICIO',
      });
      const r2 = await admin()
        .patch(`/clientes-b2b/${c.id}`)
        .send({ descuentoPorcentaje: null, modalidadPago: null })
        .expect(200);
      expect(r2.body).toMatchObject({
        descuentoPorcentaje: null,
        modalidadPago: null,
        codigo: 'cafe-test-matriz',
      });
      expect(
        (
          await admin()
            .patch(`/clientes-b2b/${c.id}`)
            .send({ descuentoPorcentaje: 150 })
        ).status,
      ).toBe(400);
    });
  });

  describe('teléfonos', () => {
    it('agregar, marcar principal, editar y quitar', async () => {
      const c = await alta();
      const [tel1, tel2] = c.telefonos;
      // agregar uno nuevo ya como principal: el anterior deja de serlo
      const r = await admin()
        .post(`/clientes-b2b/${c.id}/telefonos`)
        .send({
          telefono: '(55) 9999-0000',
          principal: true,
          nombreContacto: 'Luis',
        })
        .expect(201);
      expect(
        r.body.telefonos
          .filter((t: any) => t.principal)
          .map((t: any) => t.telefono),
      ).toEqual(['5599990000']);
      // cambiar el principal
      const r2 = await admin()
        .post(`/clientes-b2b/${c.id}/telefonos/${tel2.id}/principal`)
        .expect(201);
      expect(
        r2.body.telefonos.filter((t: any) => t.principal).map((t: any) => t.id),
      ).toEqual([tel2.id]);
      // editar número y contacto
      const r3 = await admin()
        .patch(`/clientes-b2b/${c.id}/telefonos/${tel1.id}`)
        .send({ telefono: '5577778888', nombreContacto: null })
        .expect(200);
      expect(
        r3.body.telefonos.find((t: any) => t.id === tel1.id),
      ).toMatchObject({ telefono: '5577778888', nombreContacto: null });
      // quitar uno que no es principal
      const r4 = await admin()
        .delete(`/clientes-b2b/${c.id}/telefonos/${tel1.id}`)
        .expect(200);
      expect(r4.body.telefonos).toHaveLength(2);
      // siempre exactamente un principal
      expect(
        await s.h.prisma.clienteTelefono.count({
          where: { clienteId: c.id, principal: true },
        }),
      ).toBe(1);
    });

    it('no se puede quitar el principal sin nombrar otro ni el último teléfono', async () => {
      const c = await alta();
      const [principal, otro] = c.telefonos;
      expect(
        (
          await admin().delete(
            `/clientes-b2b/${c.id}/telefonos/${principal.id}`,
          )
        ).status,
      ).toBe(409);
      await admin()
        .delete(`/clientes-b2b/${c.id}/telefonos/${otro.id}`)
        .expect(200);
      expect(
        (
          await admin().delete(
            `/clientes-b2b/${c.id}/telefonos/${principal.id}`,
          )
        ).status,
      ).toBe(409); // último
      // nombrando otro principal sí se puede quitar el anterior
      const nuevo = (
        await admin()
          .post(`/clientes-b2b/${c.id}/telefonos`)
          .send({ telefono: '5500001111' })
          .expect(201)
      ).body.telefonos.find((t: any) => t.telefono === '5500001111');
      await admin()
        .post(`/clientes-b2b/${c.id}/telefonos/${nuevo.id}/principal`)
        .expect(201);
      const r = await admin()
        .delete(`/clientes-b2b/${c.id}/telefonos/${principal.id}`)
        .expect(200);
      expect(
        r.body.telefonos.map((t: any) => [t.telefono, t.principal]),
      ).toEqual([['5500001111', true]]);
    });

    it('teléfono repetido en el mismo cliente: 409; corto: 400; id ajeno: 404', async () => {
      const c = await alta();
      const otro = await alta({
        sufijo: 'norte',
        telefonos: [{ telefono: '5500001111' }],
      });
      expect(
        (
          await admin()
            .post(`/clientes-b2b/${c.id}/telefonos`)
            .send({ telefono: '55 3333 4444' })
        ).status,
      ).toBe(409);
      expect(
        (
          await admin()
            .post(`/clientes-b2b/${c.id}/telefonos`)
            .send({ telefono: '1234567890123' })
        ).status,
      ).toBe(201);
      expect(
        (
          await admin()
            .post(`/clientes-b2b/${c.id}/telefonos`)
            .send({ telefono: '12345' })
        ).status,
      ).toBe(400);
      // un teléfono de otro cliente no se puede tocar desde éste
      expect(
        (
          await admin().delete(
            `/clientes-b2b/${c.id}/telefonos/${otro.telefonos[0].id}`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await admin().post(
            `/clientes-b2b/${c.id}/telefonos/${otro.telefonos[0].id}/principal`,
          )
        ).status,
      ).toBe(404);
    });
  });

  describe('baja y reactivación', () => {
    it('baja lógica: sale del selector y de «Activos», sigue en «De baja»/«Todos»; reactivar lo regresa', async () => {
      const c = await alta();
      const otro = await alta({
        sufijo: 'norte',
        nombre: 'Norte',
        telefonos: [{ telefono: '5500001111' }],
      });
      const r = await admin().post(`/clientes-b2b/${c.id}/baja`).expect(201);
      expect(r.body).toMatchObject({ activo: false });
      expect(r.body.bajaAt).not.toBeNull();
      expect((await admin().post(`/clientes-b2b/${c.id}/baja`)).status).toBe(
        409,
      );

      const sel = (await operador().get('/clientes-b2b/selector').expect(200))
        .body;
      expect(sel).toEqual([
        {
          id: otro.id,
          nombre: 'Norte',
          codigo: 'cafe-test-norte',
          descuentoPorcentaje: null,
        },
      ]);
      const ids = async (estado?: string) =>
        (
          await admin()
            .get('/clientes-b2b')
            .query(estado ? { estado } : {})
            .expect(200)
        ).body.data.map((x: any) => x.id);
      expect(await ids()).toEqual([otro.id]);
      expect(await ids('BAJA')).toEqual([c.id]);
      expect((await ids('TODOS')).sort()).toEqual([c.id, otro.id].sort());
      // el cliente de baja sigue consultable y editable (historial conservado)
      expect((await admin().get(`/clientes-b2b/${c.id}`)).status).toBe(200);

      const re = await admin()
        .post(`/clientes-b2b/${c.id}/reactivar`)
        .expect(201);
      expect(re.body).toMatchObject({ activo: true, bajaAt: null });
      expect(
        (await admin().post(`/clientes-b2b/${c.id}/reactivar`)).status,
      ).toBe(409);
      expect(
        (await operador().get('/clientes-b2b/selector').expect(200)).body,
      ).toHaveLength(2);
    });
  });

  describe('lista', () => {
    it('busca por nombre, código o teléfono (con formato); trae principal, descuento, pedidos activos e «incompleto»', async () => {
      const a = await alta({ descuentoPorcentaje: 10 });
      await alta({
        sufijo: 'norte',
        nombre: 'Panadería del Norte',
        telefonos: [{ telefono: '5500001111', nombreContacto: 'Rosa' }],
      });
      // pedido activo del cliente A (el flujo público aún crea su propio cliente: se reasigna a A)
      const p = await crearPublicoB2b(s.h, s.base, {
        contactoTelefono: '5588887777',
      });
      await s.h.prisma.order.update({
        where: { id: p.id },
        data: { clienteId: a.id },
      });
      await s.h.prisma.cliente.deleteMany({
        where: { telefono: '5588887777' },
      });
      // un legado sin dirección
      await s.h.prisma.cliente.update({
        where: { id: a.id },
        data: { direccion: null },
      });

      const q = async (qs: string) =>
        (await admin().get('/clientes-b2b').query({ q: qs }).expect(200)).body
          .data;
      expect((await q('aurora')).map((x: any) => x.codigo)).toEqual([
        'cafe-test-matriz',
      ]);
      expect((await q('CAFE-TEST-NORTE')).map((x: any) => x.codigo)).toEqual([
        'cafe-test-norte',
      ]);
      expect((await q('55-0000')).map((x: any) => x.codigo)).toEqual([
        'cafe-test-norte',
      ]);
      expect((await q('3333 4444')).map((x: any) => x.codigo)).toEqual([
        'cafe-test-matriz',
      ]);

      const lista = (await admin().get('/clientes-b2b').expect(200)).body;
      expect(lista).toMatchObject({
        total: 2,
        page: 1,
        limit: 25,
        totalPages: 1,
      });
      const fila = lista.data.find((x: any) => x.id === a.id);
      expect(fila).toMatchObject({
        telefonoPrincipal: '5511112222',
        nombreContactoPrincipal: 'Mariana',
        descuentoPorcentaje: 10,
        pedidosActivos: 1,
        incompleto: true,
      });
      expect(
        lista.data.find((x: any) => x.codigo === 'cafe-test-norte'),
      ).toMatchObject({ pedidosActivos: 0, incompleto: false });
    });
  });

  describe('aislamiento entre negocios', () => {
    let b: BaseSeed;
    beforeEach(async () => {
      b = await seedBase(s.h.prisma, {
        slug: 'otro-mayoreo',
        tipoStorefront: 'RETAIL_B2B',
      });
    });

    it('un cliente de otro negocio responde 404 en todo; las listas y el selector no lo incluyen', async () => {
      const c = await alta();
      const apiB = apiRol(s.h, b, 'DUENO');
      const t = c.telefonos[0].id;
      for (const r of [
        await apiB.get(`/clientes-b2b/${c.id}`),
        await apiB.patch(`/clientes-b2b/${c.id}`).send({ nombre: 'XX' }),
        await apiB.post(`/clientes-b2b/${c.id}/baja`),
        await apiB.post(`/clientes-b2b/${c.id}/reactivar`),
        await apiB
          .post(`/clientes-b2b/${c.id}/telefonos`)
          .send({ telefono: '5500000000' }),
        await apiB
          .patch(`/clientes-b2b/${c.id}/telefonos/${t}`)
          .send({ nombreContacto: 'X' }),
        await apiB.post(`/clientes-b2b/${c.id}/telefonos/${t}/principal`),
        await apiB.delete(`/clientes-b2b/${c.id}/telefonos/${t}`),
      ]) {
        expect(r.status).toBe(404);
      }
      expect((await apiB.get('/clientes-b2b').expect(200)).body.data).toEqual(
        [],
      );
      expect(
        (await apiB.get('/clientes-b2b/selector').expect(200)).body,
      ).toEqual([]);
      // A sigue intacto
      expect(
        await admin().get(`/clientes-b2b/${c.id}`).expect(200),
      ).toBeDefined();
      expect(
        (await s.h.prisma.cliente.findUniqueOrThrow({ where: { id: c.id } }))
          .nombre,
      ).toBe('Café Aurora Matriz');
    });

    it('el mismo sufijo en dos negocios da códigos distintos y no choca', async () => {
      await alta();
      const r = await apiRol(s.h, b, 'DUENO')
        .post('/clientes-b2b')
        .send(body())
        .expect(201);
      expect(r.body.codigo).toBe('otro-mayoreo-matriz');
    });
  });

  describe('GET /clientes?canal=', () => {
    it('sin canal el contrato no cambia (ni campos B2B ni filtro); con canal filtra', async () => {
      const c = await alta();
      await s.h.prisma.cliente.create({
        data: {
          tenantId: s.base.tenant.id,
          canal: 'B2C',
          telefono: '5544445555',
          nombre: 'Ana',
          primerPedidoAt: new Date(),
          ultimoPedidoAt: new Date(),
        },
      });
      const todos = (await admin().get('/clientes').expect(200)).body.data;
      expect(todos).toHaveLength(2);
      for (const x of todos) expect(Object.keys(x)).not.toContain('codigo');
      const b2c = (
        await admin().get('/clientes').query({ canal: 'B2C' }).expect(200)
      ).body;
      expect(b2c.data.map((x: any) => x.nombre)).toEqual(['Ana']);
      const b2b = (
        await admin().get('/clientes').query({ canal: 'B2B' }).expect(200)
      ).body;
      expect(b2b.data.map((x: any) => x.id)).toEqual([c.id]);
      expect(
        (await admin().get('/clientes').query({ canal: 'XX' })).status,
      ).toBe(400);
    });
  });
});
