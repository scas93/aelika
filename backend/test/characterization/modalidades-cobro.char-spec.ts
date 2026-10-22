import request from 'supertest';
import { configurarB2b } from './db';
import { usarSuite } from './helpers';
import { apiRol } from './b2b-helpers';
import { crearClienteB2b } from '../../src/clientes/cliente-b2b';

// Configuración de pagos, Fase 0 · modalidades de cobro B2B por negocio: se guardan en Tenant.modalidadesCobroB2b, al menos
// una, solo Dueño, solo mayoreo; el conteo de uso para el aviso excluye clientes de baja; un negocio nuevo arranca con
// «A crédito»; y los helpers de alta (compartidos por seeds y scripts) validan igual que la API.
describe('Modalidades de cobro B2B · Ajustes → Pagos (backend)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  const gerente = () => apiRol(s.h, s.base, 'GERENTE');
  const guardar = (modalidadesCobroB2b: unknown) =>
    dueno().patch('/tenant/me').send({ modalidadesCobroB2b });

  it('GET /tenant/me trae las modalidades activas (default del negocio: solo «A crédito») y ya no el modo anterior', async () => {
    const r = await dueno().get('/tenant/me').expect(200);
    expect(r.body.modalidadesCobroB2b).toEqual(['AL_FINAL']);
    expect(r.body).not.toHaveProperty('pedidoB2bModoCobro');
  });

  it('el Dueño activa las dos, y luego deja solo «Pago por adelantado»', async () => {
    const dos = await guardar(['AL_INICIO', 'AL_FINAL']).expect(200);
    expect(dos.body.modalidadesCobroB2b).toEqual(['AL_FINAL', 'AL_INICIO']);
    const una = await guardar(['AL_INICIO']).expect(200);
    expect(una.body.modalidadesCobroB2b).toEqual(['AL_INICIO']);
    const t = await s.h.prisma.tenant.findUniqueOrThrow({
      where: { id: s.base.tenant.id },
    });
    expect(t.modalidadesCobroB2b).toEqual(['AL_INICIO']);
  });

  it('ninguna modalidad se rechaza por PATCH /tenant/me (y no cambia lo guardado)', async () => {
    for (const mal of [
      [],
      ['NUNCA'],
      ['AL_FINAL', 'AL_FINAL'],
      'AL_FINAL',
      null,
    ]) {
      // También null: el servicio lo trata como «ninguna», no como «no tocar».
      expect((await guardar(mal)).status).toBe(400);
    }
    const t = await s.h.prisma.tenant.findUniqueOrThrow({
      where: { id: s.base.tenant.id },
    });
    expect(t.modalidadesCobroB2b).toEqual(['AL_FINAL']);
  });

  it('el modo anterior (pedidoB2bModoCobro) ya no se edita por la API: se descarta', async () => {
    await dueno()
      .patch('/tenant/me')
      .send({ pedidoB2bModoCobro: 'AL_INICIO' })
      .expect(200);
    const t = await s.h.prisma.tenant.findUniqueOrThrow({
      where: { id: s.base.tenant.id },
    });
    expect(t.pedidoB2bModoCobro).toBe('AL_FINAL');
    expect(t.modalidadesCobroB2b).toEqual(['AL_FINAL']);
  });

  it('permisos: solo el Dueño (Gerente 403 en guardar, en leer y en el conteo de uso)', async () => {
    expect(
      (
        await gerente()
          .patch('/tenant/me')
          .send({ modalidadesCobroB2b: ['AL_INICIO'] })
      ).status,
    ).toBe(403);
    expect((await gerente().get('/tenant/me')).status).toBe(403);
    expect(
      (await gerente().get('/tenant/me/modalidades-cobro/uso')).status,
    ).toBe(403);
    const t = await s.h.prisma.tenant.findUniqueOrThrow({
      where: { id: s.base.tenant.id },
    });
    expect(t.modalidadesCobroB2b).toEqual(['AL_FINAL']);
  });

  it('un negocio de menudeo no puede guardar modalidades de cobro B2B', async () => {
    const b2c = await s.h.prisma.tenant.create({
      data: {
        slug: 'menudeo-x',
        nombre: 'Menudeo X',
        botApiKey: 'k-menudeo-x',
        horarioAtencion: {},
        tipoStorefront: 'RETAIL_B2C',
      },
    });
    const user = await s.h.prisma.user.create({
      data: {
        tenantId: b2c.id,
        nombre: 'D',
        email: 'd@menudeo-x.test',
        passwordHash: 'x',
        rol: 'DUENO',
      },
    });
    const api = apiRol(
      s.h,
      {
        ...s.base,
        tenant: { id: b2c.id, slug: b2c.slug },
        dueno: { id: user.id, email: user.email },
      },
      'DUENO',
    );
    const r = await api
      .patch('/tenant/me')
      .send({ modalidadesCobroB2b: ['AL_INICIO'] });
    expect(r.status).toBe(400);
  });

  it('un negocio de mayoreo nuevo (/auth/register) arranca solo con «A crédito» activa', async () => {
    const r = await request(s.h.app.getHttpServer())
      .post('/auth/register')
      .send({
        nombreNegocio: 'Mayoreo Nuevo',
        slug: 'mayoreo-nuevo',
        nombreDueno: 'Dueña',
        email: 'nueva@mayoreo-nuevo.test',
        password: 'contrasena-larga-1234',
        giroNegocio: 'MAYORISTA',
        tipoStorefront: 'RETAIL_B2B',
      });
    expect(r.status).toBe(201);
    const t = await s.h.prisma.tenant.findUniqueOrThrow({
      where: { slug: 'mayoreo-nuevo' },
    });
    expect(t.modalidadesCobroB2b).toEqual(['AL_FINAL']);
  });

  describe('conteo de clientes por modalidad (aviso al desactivar)', () => {
    const alta = (
      sufijo: string,
      modalidadPago: 'AL_INICIO' | 'AL_FINAL',
      telefono: string,
    ) =>
      crearClienteB2b(s.h.prisma, {
        tenantId: s.base.tenant.id,
        tenantSlug: s.base.tenant.slug,
        sufijo,
        nombre: `Cliente ${sufijo}`,
        direccion: 'Calle 1',
        modalidadPago,
        modalidadesActivas: ['AL_FINAL', 'AL_INICIO'],
        telefonos: [{ telefono }],
      });

    it('cuenta solo clientes activos (sin baja) por modalidad', async () => {
      await alta('uno', 'AL_FINAL', '5511110001');
      await alta('dos', 'AL_FINAL', '5511110002');
      const baja = await alta('tres', 'AL_FINAL', '5511110003');
      await alta('cuatro', 'AL_INICIO', '5511110004');
      await s.h.prisma.cliente.update({
        where: { id: baja.id },
        data: { bajaAt: new Date() },
      });
      const r = await dueno()
        .get('/tenant/me/modalidades-cobro/uso')
        .expect(200);
      expect(r.body).toEqual({ AL_FINAL: 2, AL_INICIO: 1 });
    });

    it('un cliente de otro negocio no cuenta', async () => {
      const otro = await s.h.prisma.tenant.create({
        data: {
          slug: 'otro-may',
          nombre: 'Otro',
          botApiKey: 'k-otro-may',
          horarioAtencion: {},
          tipoStorefront: 'RETAIL_B2B',
        },
      });
      await crearClienteB2b(s.h.prisma, {
        tenantId: otro.id,
        tenantSlug: otro.slug,
        sufijo: 'x',
        nombre: 'Ajeno',
        direccion: 'Calle 1',
        modalidadPago: 'AL_FINAL',
        modalidadesActivas: ['AL_FINAL'],
        telefonos: [{ telefono: '5599990000' }],
      });
      expect(
        (await dueno().get('/tenant/me/modalidades-cobro/uso').expect(200))
          .body,
      ).toEqual({ AL_FINAL: 0, AL_INICIO: 0 });
    });
  });

  describe('helper compartido de alta (seeds y scripts): mismas reglas que la API', () => {
    const base = () => ({
      tenantId: s.base.tenant.id,
      tenantSlug: s.base.tenant.slug,
      sufijo: 'matriz',
      nombre: 'Matriz',
      direccion: 'Calle 1',
      telefonos: [{ telefono: '5511112222' }],
    });

    it('sin modalidad, o con una inactiva, rechaza y no crea nada', async () => {
      await expect(
        crearClienteB2b(s.h.prisma, {
          ...base(),
          modalidadPago: null,
          modalidadesActivas: ['AL_FINAL'],
        }),
      ).rejects.toThrow(/obligatoria/);
      await expect(
        crearClienteB2b(s.h.prisma, {
          ...base(),
          modalidadPago: 'AL_INICIO',
          modalidadesActivas: ['AL_FINAL'],
        }),
      ).rejects.toThrow(/Ajustes → Pagos/);
      expect(await s.h.prisma.cliente.count()).toBe(0);
    });

    it('con una activa crea; el upsert conserva la actual aunque esté inactiva pero no deja elegir otra inactiva', async () => {
      const { sembrarClienteB2b } =
        await import('../../src/clientes/cliente-b2b');
      await sembrarClienteB2b(s.h.prisma, {
        ...base(),
        modalidadPago: 'AL_INICIO',
        modalidadesActivas: ['AL_FINAL', 'AL_INICIO'],
      });
      // «Pago por adelantado» se desactivó: re-sembrar con la misma se acepta…
      await sembrarClienteB2b(s.h.prisma, {
        ...base(),
        nombre: 'Matriz 2',
        modalidadPago: 'AL_INICIO',
        modalidadesActivas: ['AL_FINAL'],
      });
      expect((await s.h.prisma.cliente.findFirstOrThrow()).nombre).toBe(
        'Matriz 2',
      );
      // …pero un cliente en «A crédito» no puede pasar a la inactiva.
      await sembrarClienteB2b(s.h.prisma, {
        ...base(),
        modalidadPago: 'AL_FINAL',
        modalidadesActivas: ['AL_FINAL'],
      });
      await expect(
        sembrarClienteB2b(s.h.prisma, {
          ...base(),
          modalidadPago: 'AL_INICIO',
          modalidadesActivas: ['AL_FINAL'],
        }),
      ).rejects.toThrow(/Ajustes → Pagos/);
      expect((await s.h.prisma.cliente.findFirstOrThrow()).modalidadPago).toBe(
        'AL_FINAL',
      );
    });
  });

  it('pedido nuevo: usa la modalidad del cliente aunque el negocio ya no la tenga activa', async () => {
    await configurarB2b(s.h.prisma, s.base.tenant.id, {
      modalidadesActivas: ['AL_FINAL', 'AL_INICIO'],
    });
    const c = (
      await gerente()
        .post('/clientes-b2b')
        .send({
          nombre: 'Aurora',
          direccion: 'Calle 1',
          modalidadPago: 'AL_INICIO',
          telefonos: [{ telefono: '5511112222' }],
        })
        .expect(201)
    ).body;
    await configurarB2b(s.h.prisma, s.base.tenant.id, {
      modalidadesActivas: ['AL_FINAL'],
    });
    const r = await gerente()
      .post('/pedidos-b2b')
      .send({
        clienteId: c.id,
        semanaInicio: '2026-10-05',
        items: [
          {
            productId: s.base.productoA.id,
            distribucion: [{ dia: 'LUNES', cantidad: 12 }],
          },
        ],
      })
      .expect(201);
    expect(r.body.modoCobro).toBe('AL_INICIO');
  });
});
