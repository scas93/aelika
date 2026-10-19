import request from 'supertest';
import { usarSuite } from './helpers';
import { altaClienteB2bDePrueba, apiRol, crearAdminB2b } from './b2b-helpers';

// Observabilidad del Dueño: DetalleB2B.origen (quién capturó el pedido al crearlo). Solo hacia adelante; no sale en la API.
describe('B2B · origen del pedido', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const http = () => request(s.h.app.getHttpServer());
  const H = { 'x-portal-request': '1' };
  const TEL = '3331006915';
  const entorno = { ...process.env };
  beforeEach(() => {
    process.env.PORTAL_CODIGO_EN_LOG = 'true';
    delete process.env.RAILWAY_PROJECT_NAME;
  });
  afterEach(() => {
    process.env = { ...entorno };
  });
  const slug = () => s.base.tenant.slug;
  const origen = async (id: string) =>
    (await s.h.prisma.detalleB2B.findUniqueOrThrow({ where: { orderId: id } })).origen;

  async function entrar() {
    await http().post('/portal/acceso/pedir-codigo').set(H).send({ slug: slug(), telefono: TEL }).expect(200);
    const calls = s.h.fakes.enviarCodigoAcceso.mock.calls;
    const codigo = calls[calls.length - 1][0].codigo as string;
    const v = await http().post('/portal/acceso/verificar').set(H).send({ slug: slug(), telefono: TEL, codigo }).expect(200);
    const nombre = `__Host-portal_${slug()}`;
    const c = (v.headers['set-cookie'] as unknown as string[]).find((x) => x.startsWith(`${nombre}=`)) as string;
    return `${nombre}=${c.split(';')[0].split('=')[1]}`;
  }

  it('un pedido capturado en el panel guarda PANEL_EQUIPO', async () => {
    const p = await crearAdminB2b(s.h, s.base);
    expect(await origen(p.id)).toBe('PANEL_EQUIPO');
  });

  it('un pedido creado por el cliente en el portal guarda PORTAL_CLIENTE', async () => {
    await altaClienteB2bDePrueba(s.h, s.base, { contactoTelefono: TEL });
    const cookie = await entrar();
    const r = await http()
      .post('/portal/pedidos')
      .set(H)
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'llave-origen-000001')
      .send({ slug: slug(), entregas: [{ fecha: '2026-10-05', items: [{ productId: s.base.productoA.id, cantidad: 12 }] }] })
      .expect(201);
    const orden = await s.h.prisma.order.findFirstOrThrow({ where: { tipo: 'B2B' } });
    expect(await origen(orden.id)).toBe('PORTAL_CLIENTE');
    expect(JSON.stringify(r.body)).not.toContain('origen');
  });

  it('el campo no sale en las respuestas del panel', async () => {
    const dueno = apiRol(s.h, s.base, 'DUENO');
    const p = await crearAdminB2b(s.h, s.base);
    const detalle = await dueno.get(`/pedidos-b2b/${p.id}`).expect(200);
    const lista = await dueno.get('/pedidos-b2b').expect(200);
    expect(JSON.stringify([p, detalle.body, lista.body])).not.toContain('"origen"');
  });
});
