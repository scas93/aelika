import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { ReglaEnvioService } from '../../src/notificaciones-reglas/regla-envio.service';
import { crearClienteB2b } from '../../src/clientes/cliente-b2b';
import { BaseSeed, seedBase } from './db';
import { usarSuite } from './helpers';
import { waitForCalls } from './harness';
import { apiRol, SEMANA_PROXIMA, SEMANA_SIGUIENTE } from './b2b-helpers';

// Entrega 2d · pedidos B2B sobre el cliente: descuento y modalidad del cliente, snapshots, un pedido por cliente por semana,
// baja, aislamiento, storefront de mayoreo cerrado, y notificaciones al teléfono principal.
describe('Clientes B2B · pedidos (2d)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const admin = () => apiRol(s.h, s.base, 'GERENTE');
  const operador = () => apiRol(s.h, s.base, 'OPERADOR');

  const alta = async (extra: Record<string, unknown> = {}) =>
    (
      await admin()
        .post('/clientes-b2b')
        .send({
          nombre: 'Café Aurora Matriz',
          sufijo: 'matriz',
          direccion: 'Av. Siempre Viva 123',
          telefonos: [
            {
              telefono: '5511112222',
              principal: true,
              nombreContacto: 'Mariana',
            },
            { telefono: '5533334444', nombreContacto: 'Luis' },
          ],
          ...extra,
        })
        .expect(201)
    ).body;

  // Café americano $45: LUN 6 + MIE 4 = 10 piezas = $450
  const items = (base: BaseSeed = s.base) => [
    {
      productId: base.productoA.id,
      distribucion: [
        { dia: 'LUNES', cantidad: 6 },
        { dia: 'MIERCOLES', cantidad: 4 },
      ],
    },
  ];
  const pedido = (clienteId: string, extra: Record<string, unknown> = {}) => ({
    clienteId,
    semanaInicio: SEMANA_PROXIMA,
    items: items(),
    ...extra,
  });
  const crear = async (
    clienteId: string,
    extra: Record<string, unknown> = {},
    api = admin(),
  ) => api.post('/pedidos-b2b').send(pedido(clienteId, extra));

  describe('descuento, modalidad y snapshots del cliente', () => {
    it('toma el % del cliente; si el cliente cambia a 20%, el pedido conserva el 10% (también al editarlo)', async () => {
      const c = await alta({ descuentoPorcentaje: 10 });
      const r = await crear(c.id);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({
        subtotal: '450',
        descuentoTotal: '45',
        total: '405',
        descuentoPorcentajeAplicado: '10',
        codigoDescuentoId: null,
        codigoDescuentoTexto: null,
      });

      await admin()
        .patch(`/clientes-b2b/${c.id}`)
        .send({ descuentoPorcentaje: 20 })
        .expect(200);
      const detalle = (
        await admin().get(`/pedidos-b2b/${r.body.id}`).expect(200)
      ).body;
      expect(detalle).toMatchObject({
        descuentoPorcentajeAplicado: '10',
        total: '405',
      });

      // Editar el pedido sigue usando el % guardado en el pedido (10), no el del cliente (20).
      const editado = await admin()
        .patch(`/pedidos-b2b/${r.body.id}/items`)
        .send({
          items: [
            {
              productId: s.base.productoA.id,
              distribucion: [{ dia: 'LUNES', cantidad: 20 }],
            },
          ],
        })
        .expect(200);
      expect(editado.body).toMatchObject({
        subtotal: '900',
        descuentoTotal: '90',
        total: '810',
        descuentoPorcentajeAplicado: '10',
      });
    });

    it('sin descuento: total = subtotal; un segundo cliente con 20% recibe 20%', async () => {
      const sin = await alta();
      expect((await crear(sin.id)).body).toMatchObject({
        descuentoTotal: '0',
        total: '450',
        descuentoPorcentajeAplicado: null,
      });
      const con = await alta({
        sufijo: 'norte',
        nombre: 'Norte',
        descuentoPorcentaje: 20,
        telefonos: [{ telefono: '5500001111' }],
      });
      expect((await crear(con.id)).body).toMatchObject({
        descuentoTotal: '90',
        total: '360',
        descuentoPorcentajeAplicado: '20',
      });
    });

    it('modalidad de pago: la del cliente si la tiene, si no la del negocio', async () => {
      const a = await alta({ modalidadPago: 'AL_INICIO' });
      const b = await alta({
        sufijo: 'norte',
        nombre: 'Norte',
        telefonos: [{ telefono: '5500001111' }],
      });
      expect((await crear(a.id)).body.modoCobro).toBe('AL_INICIO');
      expect((await crear(b.id)).body.modoCobro).toBe('AL_FINAL'); // default del negocio en la prueba
    });

    it('guarda como snapshot el nombre del cliente, el contacto y teléfono principal, y la nota; no crea ni toca clientes', async () => {
      const c = await alta();
      const antes = await s.h.prisma.cliente.findMany();
      const r = await crear(c.id, { notaCliente: '  Sin azúcar, por favor ' });
      expect(r.body).toMatchObject({
        negocioNombre: 'Café Aurora Matriz',
        contactoNombre: 'Mariana',
        contactoTelefono: '5511112222',
        clienteId: c.id,
      });
      const detalle = await s.h.prisma.detalleB2B.findFirstOrThrow({
        where: { orderId: r.body.id },
      });
      expect(detalle.notaCliente).toBe('Sin azúcar, por favor');

      // El cliente cambia después: el pedido conserva lo capturado.
      await admin()
        .patch(`/clientes-b2b/${c.id}`)
        .send({ nombre: 'Otro nombre' })
        .expect(200);
      const t = (
        await admin().get(`/clientes-b2b/${c.id}`)
      ).body.telefonos.find(
        (x: { telefono: string }) => x.telefono === '5533334444',
      );
      await admin()
        .post(`/clientes-b2b/${c.id}/telefonos/${t.id}/principal`)
        .expect(201);
      expect(
        (await admin().get(`/pedidos-b2b/${r.body.id}`)).body,
      ).toMatchObject({
        negocioNombre: 'Café Aurora Matriz',
        contactoNombre: 'Mariana',
        contactoTelefono: '5511112222',
      });

      // Ningún cliente nuevo; el único movimiento es su contador (recalculado, no incrementado a mano).
      const despues = await s.h.prisma.cliente.findMany();
      expect(despues).toHaveLength(antes.length);
      expect(
        (await s.h.prisma.cliente.findUniqueOrThrow({ where: { id: c.id } }))
          .totalPedidos,
      ).toBe(1);
    });
  });

  describe('un pedido por cliente por semana', () => {
    it('el segundo en la misma semana da 409 con el folio y el id existentes; otra semana sí; tras cancelar, sí', async () => {
      const c = await alta();
      const primero = (await crear(c.id)).body;
      const dup = await crear(c.id);
      expect(dup.status).toBe(409);
      expect(dup.body).toMatchObject({
        statusCode: 409,
        folio: primero.folio,
        pedidoId: primero.id,
      });
      expect(dup.body.message).toContain(primero.folio);
      expect(
        (await crear(c.id, { semanaInicio: SEMANA_SIGUIENTE })).status,
      ).toBe(201);

      await admin().patch(`/pedidos-b2b/${primero.id}/cancelar`).expect(200);
      const otro = await crear(c.id);
      expect(otro.status).toBe(201);
      expect(otro.body.id).not.toBe(primero.id);
    });

    it('dos clientes distintos pueden tener pedido la misma semana', async () => {
      const a = await alta();
      const b = await alta({
        sufijo: 'norte',
        nombre: 'Norte',
        telefonos: [{ telefono: '5500001111' }],
      });
      expect((await crear(a.id)).status).toBe(201);
      expect((await crear(b.id)).status).toBe(201);
    });

    it('dos capturas simultáneas del mismo cliente y semana: solo una se crea', async () => {
      const c = await alta();
      const resultados = await Promise.all([
        crear(c.id),
        crear(c.id),
        crear(c.id),
      ]);
      expect(resultados.map((r) => r.status).sort()).toStrictEqual([
        201, 409, 409,
      ]);
      expect(await s.h.prisma.order.count({ where: { tipo: 'B2B' } })).toBe(1);
    });
  });

  describe('rechazos', () => {
    it('cliente de baja: 409 (y se puede reactivar y pedir)', async () => {
      const c = await alta();
      await admin().post(`/clientes-b2b/${c.id}/baja`).expect(201);
      const r = await crear(c.id);
      expect(r.status).toBe(409);
      expect(r.body.message).toContain('baja');
      await admin().post(`/clientes-b2b/${c.id}/reactivar`).expect(201);
      expect((await crear(c.id)).status).toBe(201);
    });

    it('un cliente de baja con pedido activo conserva su pedido', async () => {
      const c = await alta();
      const p = (await crear(c.id)).body;
      await admin().post(`/clientes-b2b/${c.id}/baja`).expect(201);
      expect((await admin().get(`/pedidos-b2b/${p.id}`)).body).toMatchObject({
        cancelado: false,
        estado: 'PENDIENTE_CONFIRMACION',
      });
      await admin().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);
    });

    it('cliente de otro negocio, inexistente o que no es B2B: 404', async () => {
      const otro: BaseSeed = await seedBase(s.h.prisma, {
        slug: 'otro-mayoreo',
        tipoStorefront: 'RETAIL_B2B',
      });
      const ajeno = await crearClienteB2b(s.h.prisma, {
        tenantId: otro.tenant.id,
        tenantSlug: otro.tenant.slug,
        sufijo: 'x',
        nombre: 'Ajeno',
        direccion: 'D',
        telefonos: [{ telefono: '5599990000' }],
      });
      const b2c = await s.h.prisma.cliente.create({
        data: {
          tenantId: s.base.tenant.id,
          canal: 'B2C',
          telefono: '5544445555',
          nombre: 'Ana',
          primerPedidoAt: new Date(),
          ultimoPedidoAt: new Date(),
        },
      });
      for (const id of [
        ajeno.id,
        b2c.id,
        '11111111-1111-4111-8111-111111111111',
      ]) {
        const r = await crear(id);
        expect([r.status, r.body.message]).toEqual([
          404,
          'Cliente no encontrado',
        ]);
      }
      expect((await crear('no-es-uuid')).status).toBe(400);
      expect(await s.h.prisma.order.count({ where: { tipo: 'B2B' } })).toBe(0);
    });

    it('los campos viejos (negocio, contacto, código) ya no se aceptan: se ignoran y no crean cliente', async () => {
      const c = await alta();
      const r = await admin()
        .post('/pedidos-b2b')
        .send({
          ...pedido(c.id),
          negocioNombre: 'Hackeado',
          contactoTelefono: '5500000000',
          codigoDescuento: 'PROMO10',
        });
      expect(r.status).toBe(201);
      expect(r.body.negocioNombre).toBe('Café Aurora Matriz');
      expect(await s.h.prisma.cliente.count({ where: { canal: 'B2B' } })).toBe(
        1,
      );
    });

    it('semana que no es lunes: 400', async () => {
      const c = await alta();
      expect((await crear(c.id, { semanaInicio: '2026-10-06' })).status).toBe(
        400,
      );
    });
  });

  describe('permisos', () => {
    it('el Operador puede capturar pedidos; sin token 401; negocio de menudeo 403', async () => {
      const c = await alta();
      expect((await crear(c.id, {}, operador())).status).toBe(201);
      expect(
        (
          await request(s.h.app.getHttpServer())
            .post('/pedidos-b2b')
            .send(pedido(c.id))
        ).status,
      ).toBe(401);
      const b2c = await seedBase(s.h.prisma, {
        slug: 'menudeo',
        tipoStorefront: 'RETAIL_B2C',
      });
      expect(
        (
          await apiRol(s.h, b2c, 'DUENO')
            .post('/pedidos-b2b')
            .send(pedido(c.id))
        ).status,
      ).toBe(403);
    });
  });

  describe('storefront de mayoreo cerrado', () => {
    const MSG =
      'Los pedidos en línea de mayoreo se habilitan con tu cuenta de cliente. Contáctanos.';
    const post = (slug: string, body: Record<string, unknown> = {}) =>
      request(s.h.app.getHttpServer())
        .post(`/public/pedidos-b2b/tenants/${slug}/pedidos`)
        .send(body);

    it('el POST público responde 409 con el mensaje (con cualquier cuerpo) y no crea nada; el catálogo se sigue viendo', async () => {
      for (const body of [
        {},
        { negocioNombre: 'X', semanaInicio: SEMANA_PROXIMA, items: items() },
        { cualquier: 'cosa' },
      ]) {
        const r = await post(s.base.tenant.slug, body);
        expect([r.status, r.body.message]).toEqual([409, MSG]);
      }
      expect(await s.h.prisma.order.count()).toBe(0);
      expect(await s.h.prisma.cliente.count()).toBe(0);
      expect(
        (
          await request(s.h.app.getHttpServer()).get(
            `/public/pedidos-b2b/tenants/${s.base.tenant.slug}/catalog`,
          )
        ).status,
      ).toBe(200);
    });

    it('slug inexistente: 404; negocio de menudeo: 404', async () => {
      expect((await post('no-existe')).status).toBe(404);
      const b2c = await seedBase(s.h.prisma, {
        slug: 'menudeo',
        tipoStorefront: 'RETAIL_B2C',
      });
      expect((await post(b2c.tenant.slug)).status).toBe(404);
    });
  });

  describe('contadores y filtros por canal', () => {
    it('clientes activos y Top clientes cuentan solo el canal del negocio', async () => {
      const c = await alta();
      await crear(c.id);
      // Un cliente B2C con pedidos en el mismo negocio (dato de prueba): no entra a los conteos de un negocio de mayoreo.
      await s.h.prisma.cliente.create({
        data: {
          tenantId: s.base.tenant.id,
          canal: 'B2C',
          telefono: '5544445555',
          nombre: 'Ana',
          primerPedidoAt: new Date(),
          ultimoPedidoAt: new Date(),
          totalPedidos: 3,
        },
      });
      expect((await admin().get('/clientes/activos').expect(200)).body).toEqual(
        { clientesActivos: 1 },
      );
      const top = (
        await admin()
          .get('/clientes')
          .query({ conPedidos: 'true', ordenarPor: 'totalPedidos' })
          .expect(200)
      ).body.data;
      expect(top.map((x: { nombre: string }) => x.nombre)).toEqual([
        'Café Aurora Matriz',
      ]);
      // El directorio sin parámetros sigue mostrando todo (contrato sin cambios).
      expect(
        (await admin().get('/clientes').expect(200)).body.data,
      ).toHaveLength(2);
    });

    it('en un negocio de menudeo, activos y Top clientes ignoran a los B2B', async () => {
      const b2c = await seedBase(s.h.prisma, {
        slug: 'menudeo',
        tipoStorefront: 'RETAIL_B2C',
      });
      await s.h.prisma.cliente.createMany({
        data: [
          {
            tenantId: b2c.tenant.id,
            canal: 'B2C',
            telefono: '5544445555',
            nombre: 'Ana',
            primerPedidoAt: new Date(),
            ultimoPedidoAt: new Date(),
            totalPedidos: 2,
          },
          {
            tenantId: b2c.tenant.id,
            canal: 'B2B',
            telefono: null,
            codigo: 'menudeo-x',
            nombre: 'B2B suelto',
            primerPedidoAt: new Date(),
            ultimoPedidoAt: new Date(),
            totalPedidos: 5,
          },
        ],
      });
      const api = apiRol(s.h, b2c, 'DUENO');
      expect((await api.get('/clientes/activos').expect(200)).body).toEqual({
        clientesActivos: 1,
      });
      const top = (
        await api.get('/clientes').query({ conPedidos: 'true' }).expect(200)
      ).body.data;
      expect(top.map((x: { nombre: string }) => x.nombre)).toEqual(['Ana']);
    });
  });
});

// Notificaciones: filtro de reglas (baja y canal) y destinatario = teléfono principal.
describe('Clientes B2B · notificaciones (2d)', () => {
  const s = usarSuite({
    reglasReales: true,
    seed: { tipoStorefront: 'RETAIL_B2B' },
  });
  const admin = () => apiRol(s.h, s.base, 'GERENTE');
  const alta = async (sufijo: string, nombre: string, telefonos: object[]) =>
    (
      await admin()
        .post('/clientes-b2b')
        .send({
          nombre,
          sufijo,
          direccion: 'Calle 1',
          descuentoPorcentaje: 10,
          telefonos,
        })
        .expect(201)
    ).body;
  const regla = async (extra: Record<string, unknown>) =>
    (
      await admin()
        .post('/reglas')
        .send({
          nombre: 'Aviso',
          plantillaNombre: 'aviso',
          plantillaIdioma: 'es_MX',
          plantillaCategoria: 'UTILITY',
          ...extra,
        })
        .expect(201)
    ).body;

  it('una regla manual alcanza solo a clientes B2B activos: los de baja y los B2C no reciben', async () => {
    const activo = await alta('activo', 'Cliente Activo', [
      { telefono: '5511110001' },
    ]);
    const baja = await alta('baja', 'Cliente Baja', [
      { telefono: '5511110002' },
    ]);
    await admin().post(`/clientes-b2b/${baja.id}/baja`).expect(201);
    await s.h.prisma.cliente.create({
      data: {
        tenantId: s.base.tenant.id,
        canal: 'B2C',
        telefono: '5511110003',
        nombre: 'Ana B2C',
        primerPedidoAt: new Date(),
        ultimoPedidoAt: new Date(),
      },
    });
    const r = await regla({ trigger: 'MANUAL' });
    await admin().post(`/reglas/${r.id}/disparar`).expect(201);
    await waitForCalls(s.h.fakes.reglaEnvio, 1);
    expect(s.h.fakes.reglaEnvio.mock.calls.map((c) => c[1].id)).toStrictEqual([
      activo.id,
    ]);
  });

  it('de punta a punta: alta de cliente, pedido con descuento, confirmación y aviso al teléfono PRINCIPAL', async () => {
    const c = await alta('matriz', 'Café Aurora Matriz', [
      { telefono: '5511110001', nombreContacto: 'Secundario' },
      { telefono: '5511110002', principal: true, nombreContacto: 'Principal' },
    ]);
    await regla({
      trigger: 'EVENTO_PEDIDO',
      triggerConfig: { origen: 'PEDIDO_B2B', estatus: 'CONFIRMADO_SURTIENDO' },
    });

    const p = (
      await admin()
        .post('/pedidos-b2b')
        .send({
          clienteId: c.id,
          semanaInicio: SEMANA_PROXIMA,
          items: [
            {
              productId: s.base.productoA.id,
              distribucion: [{ dia: 'LUNES', cantidad: 10 }],
            },
          ],
        })
        .expect(201)
    ).body;
    expect(p).toMatchObject({
      subtotal: '450',
      total: '405',
      descuentoPorcentajeAplicado: '10',
      contactoTelefono: '5511110002',
    });
    await admin().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);

    await waitForCalls(s.h.fakes.reglaEnvio, 1);
    const [, clienteNotificado, , contexto] =
      s.h.fakes.reglaEnvio.mock.calls[0];
    expect(clienteNotificado.id).toBe(c.id);
    expect(contexto).toMatchObject({ origen: 'PEDIDO_B2B', folio: p.folio });

    // El envío real (ReglaEnvioService) manda al principal con +52: se prueba contra un Botpress local de mentira.
    const recibidos: { telefono: string }[] = [];
    const servidor = http.createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (d: Buffer) => (cuerpo += d.toString()));
      req.on('end', () => {
        recibidos.push(JSON.parse(cuerpo) as { telefono: string });
        res.writeHead(200).end('{}');
      });
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    try {
      const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/hook`;
      const tenant = await s.h.prisma.tenant.update({
        where: { id: s.base.tenant.id },
        data: { botWebhookUrl: url },
      });
      const reglaDb = await s.h.prisma.regla.findFirstOrThrow({
        where: { tenantId: tenant.id },
      });
      const cliente = await s.h.prisma.cliente.findUniqueOrThrow({
        where: { id: c.id },
      });
      const real = new ReglaEnvioService(s.h.prisma, {
        get: () => undefined,
      } as unknown as ConfigService);
      await real.enviar(tenant, cliente, reglaDb);
      expect(recibidos.map((r) => r.telefono)).toStrictEqual(['+525511110002']);
    } finally {
      servidor.close();
    }
  });
});
