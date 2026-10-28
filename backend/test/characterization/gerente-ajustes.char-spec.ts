import { expectError } from './exacto';
import { usarSuite } from './helpers';
import { apiRol } from './b2b-helpers';

// Ajustes para el Gerente: solo Información del negocio (/tenant/negocio) y Equipo (/users), con límites que aplica el backend.
const MSG = 'No tienes permiso para realizar esta acción';
const MSG_ADMIN = 'Solo un Admin puede crear, ascender o modificar a otro Admin';

describe('Ajustes · Información del negocio', () => {
  const s = usarSuite();
  const gerente = () => apiRol(s.h, s.base, 'GERENTE');
  const dueno = () => apiRol(s.h, s.base, 'DUENO');

  it('Gerente y Dueño leen y editan solo los 4 campos del negocio; el Operador recibe 403', async () => {
    const ger_ = gerente();
    const dueno_ = dueno();
    for (const api of [ger_, dueno_]) {
      const r = (await api.get('/tenant/negocio').expect(200)).body;
      expect(Object.keys(r).sort()).toStrictEqual(
        api === dueno_ ? ['giroNegocio', 'horarioAtencion', 'mensajeBienvenida', 'ubicacion'] : ['horarioAtencion', 'mensajeBienvenida', 'ubicacion'],
      );
    }
    const editado = (await gerente().patch('/tenant/negocio').send({ mensajeBienvenida: 'Hola desde Gerente', ubicacion: 'Calle 9' }).expect(200)).body;
    expect(editado.mensajeBienvenida).toBe('Hola desde Gerente');
    expect(editado.ubicacion).toBe('Calle 9');
    expect((await dueno().get('/tenant/negocio').expect(200)).body.ubicacion).toBe('Calle 9');
    expectError(await apiRol(s.h, s.base, 'OPERADOR').get('/tenant/negocio'), 403, MSG);
    expectError(await apiRol(s.h, s.base, 'OPERADOR').patch('/tenant/negocio').send({ ubicacion: 'x' }), 403, MSG);
  });

  it('el giro es del Admin: el Gerente no lo recibe ni lo cambia (aunque lo mande); el Admin sí lo lee y lo edita', async () => {
    await dueno().patch('/tenant/negocio').send({ giroNegocio: 'RESTAURANTE' }).expect(200);
    const giroEnBase = async () => (await s.h.prisma.tenant.findUniqueOrThrow({ where: { id: s.base.tenant.id } })).giroNegocio;
    expect(await giroEnBase()).toBe('RESTAURANTE');
    expect((await dueno().get('/tenant/negocio').expect(200)).body.giroNegocio).toBe('RESTAURANTE');

    const get = (await gerente().get('/tenant/negocio').expect(200)).body;
    expect('giroNegocio' in get).toBe(false);
    const patch = (await gerente().patch('/tenant/negocio').send({ giroNegocio: 'CAFETERIA', ubicacion: 'Calle 10' }).expect(200)).body;
    expect('giroNegocio' in patch).toBe(false);
    expect(patch.ubicacion).toBe('Calle 10');
    expect(await giroEnBase()).toBe('RESTAURANTE');

    const cambiado = (await dueno().patch('/tenant/negocio').send({ giroNegocio: 'CAFETERIA' }).expect(200)).body;
    expect(cambiado.giroNegocio).toBe('CAFETERIA');
    expect(await giroEnBase()).toBe('CAFETERIA');
  });

  it('el Gerente no puede leer ni escribir otros datos del tenant, ni por /tenant/negocio ni por /tenant/me', async () => {
    const antes = (await dueno().get('/tenant/me').expect(200)).body;
    // Campos ajenos mandados a /tenant/negocio se descartan (whitelist): nada cambia.
    await gerente()
      .patch('/tenant/negocio')
      .send({ facturacionModo: 'OBLIGATORIO', botWebhookUrl: 'https://x.test/hook', stripeContactEmail: 'x@x.com', pedidoB2bMinimoPiezas: 99, numeroAtencion: '5512345678' })
      .expect(200);
    const despues = (await dueno().get('/tenant/me').expect(200)).body;
    for (const k of ['facturacionModo', 'botWebhookUrl', 'stripeContactEmail', 'pedidoB2bMinimoPiezas', 'numeroAtencion', 'botApiKey']) {
      expect(despues[k]).toStrictEqual(antes[k]);
    }
    expectError(await gerente().get('/tenant/me'), 403, MSG);
    expectError(await gerente().patch('/tenant/me').send({ mensajeBienvenida: 'x' }), 403, MSG);
    expectError(await gerente().post('/tenant/me/regenerate-bot-key', {}), 403, MSG);
    expectError(await gerente().get('/tenant/me/stripe-status'), 403, MSG);
    expectError(await gerente().get('/tenant/me/modalidades-cobro/uso'), 403, MSG);
  });

  it('GET /tenant/negocio no incluye llaves ni configuración de otros módulos (texto de la respuesta)', async () => {
    const texto = JSON.stringify((await gerente().get('/tenant/negocio').expect(200)).body);
    for (const prohibido of ['botApiKey', 'stripe', 'facturacion', 'webhook', 'modalidades', 'portal']) {
      expect(texto.toLowerCase()).not.toContain(prohibido.toLowerCase());
    }
  });
});

describe('Ajustes · Equipo', () => {
  const s = usarSuite();
  const gerente = () => apiRol(s.h, s.base, 'GERENTE');
  const dueno = () => apiRol(s.h, s.base, 'DUENO');

  it('el Gerente ve a todos, incluidos los Dueños; el Operador recibe 403', async () => {
    const lista = (await gerente().get('/users').expect(200)).body as { id: string; rol: string }[];
    expect(lista.map((u) => u.rol).sort()).toStrictEqual(['DUENO', 'GERENTE', 'OPERADOR']);
    expectError(await apiRol(s.h, s.base, 'OPERADOR').get('/users'), 403, MSG);
    expectError(await apiRol(s.h, s.base, 'OPERADOR').post('/users', { nombre: 'Xx', email: 'x@x.com', rol: 'OPERADOR' }), 403, MSG);
  });

  it('el Gerente crea Operadores y Gerentes, pero no Dueños', async () => {
    await gerente().post('/users').send({ nombre: 'Nuevo Op', email: 'op2@x.com', rol: 'OPERADOR' }).expect(201);
    await gerente().post('/users').send({ nombre: 'Nuevo Ger', email: 'ger2@x.com', rol: 'GERENTE' }).expect(201);
    expectError(await gerente().post('/users').send({ nombre: 'Nuevo Dueño', email: 'dueno2@x.com', rol: 'DUENO' }), 403, MSG_ADMIN);
    const emails = ((await dueno().get('/users').expect(200)).body as { email: string }[]).map((u) => u.email);
    expect(emails).not.toContain('dueno2@x.com');
  });

  it('el Gerente mueve Operador↔Gerente y activa/desactiva, pero no asciende a Dueño ni toca a un Dueño', async () => {
    const op = s.base.operador.id;
    await gerente().patch(`/users/${op}`).send({ rol: 'GERENTE' }).expect(200);
    await gerente().patch(`/users/${op}`).send({ rol: 'OPERADOR', activo: false }).expect(200);
    await gerente().patch(`/users/${op}`).send({ activo: true }).expect(200);
    expectError(await gerente().patch(`/users/${op}`).send({ rol: 'DUENO' }), 403, MSG_ADMIN);
    expectError(await gerente().patch(`/users/${s.base.dueno.id}`).send({ rol: 'GERENTE' }), 403, MSG_ADMIN);
    expectError(await gerente().patch(`/users/${s.base.dueno.id}`).send({ activo: false }), 403, MSG_ADMIN);
    const dueno = await s.h.prisma.user.findUniqueOrThrow({ where: { id: s.base.dueno.id } });
    expect([dueno.rol, dueno.activo]).toStrictEqual(['DUENO', true]);
  });

  it('nadie se edita a sí mismo y siempre queda un Dueño activo; el Dueño conserva todo', async () => {
    expectError(await gerente().patch(`/users/${s.base.gerente.id}`).send({ rol: 'OPERADOR' }), 403, 'No puedes editarte a ti mismo desde aquí');
    // Dueño crea y asciende a otro Dueño; luego puede degradarlo, pero no dejar el negocio sin Admin activo.
    const creado = (await dueno().post('/users').send({ nombre: 'Otro Admin', email: 'admin2@x.com', rol: 'DUENO' }).expect(201)).body;
    await dueno().patch(`/users/${s.base.operador.id}`).send({ rol: 'DUENO' }).expect(200);
    await dueno().patch(`/users/${creado.id}`).send({ activo: false }).expect(200);
    await dueno().patch(`/users/${s.base.operador.id}`).send({ rol: 'OPERADOR' }).expect(200);
    await s.h.prisma.user.update({ where: { id: creado.id }, data: { rol: 'GERENTE' } });
    const unico = await s.h.prisma.user.findMany({ where: { tenantId: s.base.tenant.id, rol: 'DUENO', activo: true } });
    expect(unico).toHaveLength(1);
  });
});
