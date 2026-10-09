import request from 'supertest';
import { seedBase } from './db';
import { clienteEsperado, expectExacto } from './exacto';
import { bodyCheckout, postCheckoutMixto, usarSuite } from './helpers';
import { normalizar } from './normalizar';
import { apiRol, bodyB2b, crearAdminB2b, crearPublicoB2b } from './b2b-helpers';
import { waitForCalls } from './harness';

// 0b-2 · Áreas 12 y 13 · Cliente entre canales y Cliente desde Lealtad.
describe('Transversal · Cliente entre canales (mismo teléfono)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B', b2b: {} } });
  const TEL = '+52 55 3333 4444';

  it('en un MISMO tenant, el mismo teléfono por checkout B2C y por pedido B2B genera dos Cliente (@@unique tenant+canal+teléfono)', async () => {
    const o = await postCheckoutMixto(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: TEL, clienteNombre: 'Luis Persona' }));
    jest.setSystemTime(new Date('2026-09-30T17:00:00.000Z'));
    const p = await crearPublicoB2b(s.h, s.base, { contactoTelefono: TEL, contactoNombre: 'Luis Compras' });

    const clientes = await s.h.prisma.cliente.findMany({ orderBy: { canal: 'asc' } });
    expect(clientes).toHaveLength(2);
    expect(clientes.map((c) => [c.canal, c.telefono, c.nombre, c.totalPedidos])).toStrictEqual([
      ['B2C', '5533334444', 'Luis Persona', 1], // el enum ClienteCanal ordena B2C antes que B2B
      ['B2B', '5533334444', 'Luis Compras', 1],
    ]);
    // cada pedido apunta a su Cliente (mismo teléfono, canales distintos)
    expect(o.body.clienteId).toBe(clientes.find((c) => c.canal === 'B2C')!.id);
    expect(p.clienteId).toBe(clientes.find((c) => c.canal === 'B2B')!.id);
    expect(o.body.clienteId).not.toBe(p.clienteId);
    await waitForCalls(s.h.fakes.queueAdd);
  });

  it('cada canal suma solo a su propio Cliente (recompra B2C no toca al B2B y viceversa)', async () => {
    await postCheckoutMixto(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: TEL }));
    await crearAdminB2b(s.h, s.base, { contactoTelefono: TEL });
    await crearAdminB2b(s.h, s.base, { contactoTelefono: '55-3333-4444' });
    await postCheckoutMixto(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: '5533334444' }));
    await postCheckoutMixto(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: '5533334444' }));
    const clientes = await s.h.prisma.cliente.findMany({ orderBy: { canal: 'asc' } });
    expect(clientes.map((c) => [c.canal, c.totalPedidos])).toStrictEqual([
      ['B2C', 3],
      ['B2B', 2],
    ]);
    await waitForCalls(s.h.fakes.queueAdd, 3);
  });

  it('GET /clientes muestra ambos canales del mismo teléfono como filas separadas (forma exacta)', async () => {
    await postCheckoutMixto(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: TEL, clienteNombre: 'Luis Persona' }));
    jest.setSystemTime(new Date('2026-09-30T17:00:00.000Z'));
    await apiRol(s.h, s.base, 'DUENO').post('/pedidos-b2b', bodyB2b(s.base, { contactoTelefono: TEL, contactoNombre: 'Luis Compras' })).expect(201);
    const res = await apiRol(s.h, s.base, 'DUENO').get('/clientes').expect(200);
    expect(normalizar(res.body.data, { [s.base.tenant.id]: 'tenant' })).toStrictEqual([
      clienteEsperado({ canal: 'B2B', telefono: '5533334444', nombre: 'Luis Compras', correo: 'compras@laesquina.test' }),
      clienteEsperado({ canal: 'B2C', telefono: '5533334444', nombre: 'Luis Persona' }),
    ]);
    await waitForCalls(s.h.fakes.queueAdd);
  });

  it('en tenants distintos (uno B2C y otro B2B) el mismo teléfono también son Cliente distintos', async () => {
    const b2b = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B', b2b: {} });
    await postCheckoutMixto(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: TEL }));
    await crearPublicoB2b(s.h, b2b, { contactoTelefono: TEL });
    const clientes = await s.h.prisma.cliente.findMany();
    expect(clientes).toHaveLength(2);
    expect(new Set(clientes.map((c) => c.tenantId)).size).toBe(2);
    await waitForCalls(s.h.fakes.queueAdd);
  });
});

describe('Transversal · Cliente dado de alta por Lealtad y su primer pedido', () => {
  // Etapa 2: los pedidos B2B exigen un tenant RETAIL_B2B (mínimo 100, el default de la base, como antes).
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B', b2b: { minimoPiezas: 100 } } });
  const alta = (rol: 'DUENO' | 'OPERADOR' = 'OPERADOR') => apiRol(s.h, s.base, rol).post('/lealtad/clientes', { nombre: 'Beto Lealtad', telefono: '55 4444 5555' });

  it('alta por el panel: Cliente B2C con totalPedidos 0 (fechas = fecha de alta), tarjeta y pase; forma exacta de la respuesta', async () => {
    const res = await alta();
    expect(res.status).toBe(201);
    const cliente = (await s.h.prisma.cliente.findMany())[0];
    expect(normalizar(res.body, { [s.base.tenant.id]: 'tenant', [cliente.id]: 'cliente' })).toStrictEqual({
      loyaltyCard: {
        id: '<uuid>',
        tenantId: '<tenant>',
        clienteId: '<cliente>',
        token: expect.any(String),
        contador: 0,
        estado: 'EN_PROGRESO',
        serialNumber: 'serial-char-1',
        createdAt: '<iso>',
        updatedAt: '<iso>',
      },
      pase: {
        serialNumber: 'serial-char-1',
        googleSaveUrl: 'https://wallet.test/google/1',
        applePass: 'apple-pass-1',
        shareUrl: 'https://wallet.test/share/1',
      },
    });
    expect(JSON.parse(JSON.stringify(cliente))).toStrictEqual({
      id: cliente.id,
      tenantId: s.base.tenant.id,
      canal: 'B2C',
      telefono: '5544445555',
      // 2a (cambia a propósito): columnas nuevas del Cliente B2B, siempre null en B2C.
      bajaAt: null,
      codigo: null,
      descuentoPorcentaje: null,
      direccion: null,
      modalidadPago: null,
      nombre: 'Beto Lealtad',
      correo: null,
      primerPedidoAt: '2026-09-30T16:00:00.000Z',
      ultimoPedidoAt: '2026-09-30T16:00:00.000Z',
      totalPedidos: 0,
      createdAt: '2026-09-30T16:00:00.000Z',
      updatedAt: '2026-09-30T16:00:00.000Z',
    });
    // Lo que recibe WalletWallet (sustituido): tarjeta, nombre del cliente, del negocio y si ya canjeó
    expect(s.h.fakes.walletCrearPase).toHaveBeenCalledTimes(1);
    const entrada = s.h.fakes.walletCrearPase.mock.calls[0][0];
    expect({ clienteNombre: entrada.clienteNombre, tenantNombre: entrada.tenantNombre, yaCanjeoPremio: entrada.yaCanjeoPremio, contador: entrada.loyaltyCard.contador }).toStrictEqual({
      clienteNombre: 'Beto Lealtad',
      tenantNombre: 'Negocio cafe-test',
      yaCanjeoPremio: false,
      contador: 0,
    });
  });

  // A2 (cambia a propósito): primerPedidoAt ya no se queda en la fecha de alta de Lealtad; se recalcula desde el primer pedido pagado.
  it('su primer pedido B2C: totalPedidos pasa a 1, primer y último pedido = fecha del pedido (ya no la de alta) y el nombre lo pisa el pedido', async () => {
    await alta();
    jest.setSystemTime(new Date('2026-09-30T18:00:00.000Z'));
    const res = await postCheckoutMixto(
      s.h,
      s.base.tenant.slug,
      bodyCheckout(s.base, { clienteTelefono: '+52 55 4444 5555', clienteNombre: 'Alberto Pedido', clienteCorreo: 'beto@test.com' }),
    );
    expect(res.status).toBe(201);

    const clientes = await s.h.prisma.cliente.findMany();
    expect(clientes).toHaveLength(1); // mismo Cliente, no un duplicado
    expect(JSON.parse(JSON.stringify(clientes[0]))).toStrictEqual({
      id: clientes[0].id,
      tenantId: s.base.tenant.id,
      canal: 'B2C',
      telefono: '5544445555',
      // 2a (cambia a propósito): columnas nuevas del Cliente B2B, siempre null en B2C.
      bajaAt: null,
      codigo: null,
      descuentoPorcentaje: null,
      direccion: null,
      modalidadPago: null,
      nombre: 'Alberto Pedido',
      correo: 'beto@test.com',
      primerPedidoAt: '2026-09-30T18:00:00.000Z', // A2: fecha del primer pedido pagado (antes: la de alta en Lealtad)
      ultimoPedidoAt: '2026-09-30T18:00:00.000Z',
      totalPedidos: 1,
      createdAt: '2026-09-30T16:00:00.000Z',
      updatedAt: '2026-09-30T18:00:00.000Z',
    });
    expect(res.body.clienteId).toBe(clientes[0].id);
    expect(await s.h.prisma.loyaltyCard.count()).toBe(1);
    await waitForCalls(s.h.fakes.queueAdd);
  });

  it('el dashboard lo cuenta como nuevo el día del alta (summaryDaily usa primerPedidoAt)', async () => {
    await alta();
    jest.setSystemTime(new Date('2026-09-30T18:00:00.000Z'));
    await postCheckoutMixto(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: '5544445555' }));
    await waitForCalls(s.h.fakes.queueAdd);
    const res = await apiRol(s.h, s.base, 'DUENO')
      .get('/clientes/summary/daily?desde=2026-09-30T06:00:00.000Z&hasta=2026-10-01T05:59:59.999Z')
      .expect(200);
    expect(res.body.at(-1)).toStrictEqual({ fecha: '2026-09-30', nuevos: 1, recurrentes: 0 });
  });

  it('un Cliente que YA tenía pedidos no se modifica al inscribirse en Lealtad (busca-o-crea, nunca actualiza)', async () => {
    await postCheckoutMixto(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteTelefono: '5544445555', clienteNombre: 'Beto Original' }));
    await waitForCalls(s.h.fakes.queueAdd);
    jest.setSystemTime(new Date('2026-09-30T19:00:00.000Z'));
    await alta('DUENO').expect(201);
    const clientes = await s.h.prisma.cliente.findMany();
    expect(clientes).toHaveLength(1);
    expect(clientes[0]).toMatchObject({ nombre: 'Beto Original', totalPedidos: 1 });
    expect(clientes[0].ultimoPedidoAt.toISOString()).toBe('2026-09-30T16:00:00.000Z');
    expect(await s.h.prisma.loyaltyCard.count()).toBe(1);
  });

  it('alta pública por slug (auto-registro): mismo efecto en Cliente', async () => {
    const res = await request(s.h.app.getHttpServer())
      .post(`/public/lealtad/tenants/${s.base.tenant.slug}/clientes`)
      .send({ nombre: 'Beto Lealtad', telefono: '55 4444 5555' });
    expect(res.status).toBe(201);
    const clientes = await s.h.prisma.cliente.findMany();
    expect(clientes.map((c) => [c.canal, c.telefono, c.nombre, c.totalPedidos])).toStrictEqual([['B2C', '5544445555', 'Beto Lealtad', 0]]);
  });

  it('un teléfono que ya existe como Cliente B2B no se reutiliza: Lealtad crea un Cliente B2C aparte', async () => {
    await apiRol(s.h, s.base, 'DUENO').post('/pedidos-b2b', bodyB2b(s.base, { contactoTelefono: '55 4444 5555' })).expect(201);
    await alta('DUENO').expect(201);
    const clientes = await s.h.prisma.cliente.findMany({ where: { tenantId: s.base.tenant.id }, orderBy: { canal: 'asc' } });
    expect(clientes.map((c) => [c.canal, c.totalPedidos])).toStrictEqual([
      ['B2C', 0],
      ['B2B', 1],
    ]);
  });
});
