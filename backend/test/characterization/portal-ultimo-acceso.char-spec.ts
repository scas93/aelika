import request from 'supertest';
import { usarSuite, AHORA } from './helpers';
import { apiRol } from './b2b-helpers';
import { crearClienteB2b } from '../../src/clientes/cliente-b2b';

// Observabilidad del Dueño: Cliente.ultimoAccesoAt (último acceso al portal como cliente ACTIVO).
describe('Portal · último acceso del cliente', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const http = () => request(s.h.app.getHttpServer());
  const TEL = '3331006915';
  const H = { 'x-portal-request': '1' };
  const entorno = { ...process.env };
  beforeEach(() => {
    process.env.PORTAL_CODIGO_EN_LOG = 'true';
    delete process.env.RAILWAY_PROJECT_NAME;
  });
  afterEach(() => {
    process.env = { ...entorno };
  });

  const slug = () => s.base.tenant.slug;
  const nombreCookie = () => `__Host-portal_${slug()}`;
  const alta = (nombre: string, sufijo: string) =>
    crearClienteB2b(s.h.prisma, {
      tenantId: s.base.tenant.id,
      modalidadPago: 'AL_FINAL',
      modalidadesActivas: ['AL_FINAL', 'AL_INICIO'],
      tenantSlug: slug(),
      sufijo,
      nombre,
      direccion: 'Calle 1',
      telefonos: [{ telefono: TEL, principal: true }],
    });
  const acceso = async (id: string) =>
    (await s.h.prisma.cliente.findUniqueOrThrow({ where: { id } })).ultimoAccesoAt?.toISOString() ?? null;
  const avanzar = (ms: number) => jest.setSystemTime(new Date(new Date(AHORA).getTime() + ms));
  const ultimoCodigo = () => {
    const calls = s.h.fakes.enviarCodigoAcceso.mock.calls;
    return calls[calls.length - 1][0].codigo as string;
  };

  async function entrar() {
    await http().post('/portal/acceso/pedir-codigo').set(H).send({ slug: slug(), telefono: TEL }).expect(200);
    const res = await http()
      .post('/portal/acceso/verificar')
      .set(H)
      .send({ slug: slug(), telefono: TEL, codigo: ultimoCodigo() })
      .expect(200);
    const c = (res.headers['set-cookie'] as unknown as string[]).find((x) => x.startsWith(`${nombreCookie()}=`)) as string;
    return { res, cookie: `${nombreCookie()}=${c.split(';')[0].split('=')[1]}` };
  }
  const sesion = (cookie: string) => http().get(`/portal/acceso/sesion?slug=${slug()}`).set('Cookie', cookie);

  it('sin accesos previos queda sin dato', async () => {
    const c = await alta('Café Aurora', 'aurora');
    expect(await acceso(c.id)).toBeNull();
  });

  it('verificar el OTP con un solo cliente lo marca', async () => {
    const c = await alta('Café Aurora', 'aurora');
    await entrar();
    expect(await acceso(c.id)).toBe(AHORA);
  });

  it('con varios clientes en el teléfono, verificar no marca a ninguno; elegir marca solo al elegido', async () => {
    const a = await alta('Café Aurora', 'aurora');
    const b = await alta('Café Boreal', 'boreal');
    const { res, cookie } = await entrar();
    expect(res.body.requiereSeleccion).toBe(true);
    expect(await acceso(a.id)).toBeNull();
    expect(await acceso(b.id)).toBeNull();

    avanzar(10 * 60_000);
    await http().post('/portal/acceso/cliente').set(H).set('Cookie', cookie).send({ slug: slug(), clienteId: b.id }).expect(200);
    expect(await acceso(a.id)).toBeNull();
    expect(await acceso(b.id)).toBe(new Date(new Date(AHORA).getTime() + 10 * 60_000).toISOString());

    // Cambiar al otro cliente marca al nuevo activo, sin tocar al anterior.
    avanzar(20 * 60_000);
    await http().post('/portal/acceso/cliente').set(H).set('Cookie', cookie).send({ slug: slug(), clienteId: a.id }).expect(200);
    expect(await acceso(a.id)).toBe(new Date(new Date(AHORA).getTime() + 20 * 60_000).toISOString());
    expect(await acceso(b.id)).toBe(new Date(new Date(AHORA).getTime() + 10 * 60_000).toISOString());
  });

  it('reanudar la sesión dentro de la hora no escribe; pasada la hora sí', async () => {
    const c = await alta('Café Aurora', 'aurora');
    const { cookie } = await entrar();
    expect(await acceso(c.id)).toBe(AHORA);

    avanzar(59 * 60_000);
    await sesion(cookie).expect(200);
    expect(await acceso(c.id)).toBe(AHORA);

    avanzar(61 * 60_000);
    await sesion(cookie).expect(200);
    expect(await acceso(c.id)).toBe(new Date(new Date(AHORA).getTime() + 61 * 60_000).toISOString());
  });

  it('reanudar una sesión de un cliente sin dato lo marca (clientes anteriores al cambio)', async () => {
    const c = await alta('Café Aurora', 'aurora');
    const { cookie } = await entrar();
    await s.h.prisma.cliente.update({ where: { id: c.id }, data: { ultimoAccesoAt: null } });
    avanzar(5 * 60_000);
    await sesion(cookie).expect(200);
    expect(await acceso(c.id)).toBe(new Date(new Date(AHORA).getTime() + 5 * 60_000).toISOString());
  });

  it('reanudar sin cliente activo (varios clientes, sin elegir) no marca a nadie', async () => {
    const a = await alta('Café Aurora', 'aurora');
    const b = await alta('Café Boreal', 'boreal');
    const { cookie } = await entrar();
    avanzar(2 * 3600_000);
    await sesion(cookie).expect(200);
    expect(await acceso(a.id)).toBeNull();
    expect(await acceso(b.id)).toBeNull();
  });

  it('el campo no sale en la API: /sesion ni el directorio de clientes', async () => {
    await alta('Café Aurora', 'aurora');
    const { cookie } = await entrar();
    const ses = await sesion(cookie).expect(200);
    expect(JSON.stringify(ses.body)).not.toContain('ultimoAccesoAt');
    const dueno = apiRol(s.h, s.base, 'DUENO');
    for (const url of ['/clientes', '/clientes?canal=B2B', '/clientes-b2b']) {
      const r = await dueno.get(url).expect(200);
      expect(JSON.stringify(r.body)).not.toContain('ultimoAccesoAt');
    }
    const lista = await dueno.get('/clientes-b2b').expect(200);
    const id = lista.body.data[0].id;
    expect(JSON.stringify((await dueno.get(`/clientes-b2b/${id}`).expect(200)).body)).not.toContain('ultimoAccesoAt');
  });
});
