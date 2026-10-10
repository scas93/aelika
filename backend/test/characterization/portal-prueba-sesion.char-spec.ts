import request from 'supertest';
import { usarSuite } from './helpers';

// Fase 4 · entrega 4a · prueba de sesión del portal (tabla temporal SesionPrueba, solo staging).
describe('Portal · prueba de sesión (4a)', () => {
  const s = usarSuite();
  const NOMBRE = '__Host-portal_prueba';
  const http = () => request(s.h.app.getHttpServer());
  const antes = process.env.RAILWAY_PROJECT_NAME;

  afterEach(() => {
    if (antes === undefined) delete process.env.RAILWAY_PROJECT_NAME;
    else process.env.RAILWAY_PROJECT_NAME = antes;
  });

  const setCookie = (res: request.Response): string => {
    const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
    const c = raw?.find((x) => x.startsWith(`${NOMBRE}=`));
    expect(c).toBeDefined();
    return c as string;
  };
  const tokenDe = (c: string) => c.split(';')[0].slice(NOMBRE.length + 1);

  it('iniciar: pone la cookie con los atributos correctos y guarda solo el hash', async () => {
    const res = await http()
      .post('/portal/prueba-sesion/iniciar')
      .set('User-Agent', 'WhatsApp/iOS test')
      .expect(201);
    expect(res.body).toMatchObject({ activa: true });
    expect(res.headers['cache-control']).toBe('no-store');

    const c = setCookie(res);
    expect(c).toMatch(/;\s*HttpOnly/i);
    expect(c).toMatch(/;\s*Secure/i);
    expect(c).toMatch(/;\s*SameSite=Lax/i);
    expect(c).toMatch(/;\s*Path=\//i);
    expect(c).toMatch(/Max-Age=7776000/); // 90 días
    expect(c).not.toMatch(/Domain=/i);

    const filas = await s.h.prisma.sesionPrueba.findMany();
    expect(filas).toHaveLength(1);
    const token = tokenDe(c);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(filas[0].tokenHash).not.toBe(token);
    expect(filas[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(filas[0].userAgent).toBe('WhatsApp/iOS test');
  });

  it('estado sin cookie: 200 {activa:false}, sin Set-Cookie, no-store', async () => {
    const res = await http().get('/portal/prueba-sesion/estado').expect(200);
    expect(res.body).toEqual({ activa: false });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('estado con cookie inválida: {activa:false} y la borra', async () => {
    const res = await http()
      .get('/portal/prueba-sesion/estado')
      .set('Cookie', `${NOMBRE}=no-existe`)
      .expect(200);
    expect(res.body).toEqual({ activa: false });
    const c = setCookie(res);
    expect(c).toMatch(/Expires=Thu, 01 Jan 1970/i);
    expect(c).toMatch(/Path=\//);
  });

  it('estado con sesión válida: devuelve fechas, renueva el vencimiento y vuelve a poner la cookie', async () => {
    const ini = await http().post('/portal/prueba-sesion/iniciar').expect(201);
    const token = tokenDe(setCookie(ini));
    const fila0 = await s.h.prisma.sesionPrueba.findFirstOrThrow();

    // 3 días después: la lectura renueva (venceAt = ahora + 90 días) y re-emite la cookie.
    jest.setSystemTime(
      new Date(fila0.creadaAt.getTime() + 3 * 24 * 3600 * 1000),
    );
    const res = await http()
      .get('/portal/prueba-sesion/estado')
      .set('Cookie', `${NOMBRE}=${token}`)
      .expect(200);

    expect(res.body.activa).toBe(true);
    expect(new Date(res.body.creadaAt).getTime()).toBe(
      fila0.creadaAt.getTime(),
    );
    expect(new Date(res.body.renovacionAnteriorAt).getTime()).toBe(
      fila0.renovadaAt.getTime(),
    );
    expect(new Date(res.body.renovadaAt).getTime()).toBeGreaterThan(
      fila0.renovadaAt.getTime(),
    );
    expect(new Date(res.body.venceAt).getTime()).toBeGreaterThan(
      fila0.venceAt.getTime(),
    );
    const c = setCookie(res);
    expect(tokenDe(c)).toBe(token);
    expect(c).toMatch(/Max-Age=7776000/);
    expect(res.headers['cache-control']).toBe('no-store');

    const fila1 = await s.h.prisma.sesionPrueba.findFirstOrThrow();
    expect(fila1.renovadaAt.getTime()).toBeGreaterThan(
      fila0.renovadaAt.getTime(),
    );
    expect(fila1.venceAt.getTime()).toBe(new Date(res.body.venceAt).getTime());
  });

  it('una sesión vencida ya no sirve', async () => {
    const ini = await http().post('/portal/prueba-sesion/iniciar').expect(201);
    const token = tokenDe(setCookie(ini));
    const fila = await s.h.prisma.sesionPrueba.findFirstOrThrow();
    jest.setSystemTime(new Date(fila.venceAt.getTime() + 1000));
    const res = await http()
      .get('/portal/prueba-sesion/estado')
      .set('Cookie', `${NOMBRE}=${token}`)
      .expect(200);
    expect(res.body).toEqual({ activa: false });
  });

  it('cerrar: borra la sesión y la cookie; después el token ya no es válido', async () => {
    const ini = await http().post('/portal/prueba-sesion/iniciar').expect(201);
    const token = tokenDe(setCookie(ini));

    const res = await http()
      .post('/portal/prueba-sesion/cerrar')
      .set('Cookie', `${NOMBRE}=${token}`)
      .expect(200);
    expect(res.body).toEqual({ activa: false });
    expect(setCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/i);
    expect(await s.h.prisma.sesionPrueba.count()).toBe(0);

    const despues = await http()
      .get('/portal/prueba-sesion/estado')
      .set('Cookie', `${NOMBRE}=${token}`)
      .expect(200);
    expect(despues.body).toEqual({ activa: false });
  });

  it('iniciar de nuevo reemplaza la sesión anterior del mismo navegador', async () => {
    const a = await http().post('/portal/prueba-sesion/iniciar').expect(201);
    const t1 = tokenDe(setCookie(a));
    await http()
      .post('/portal/prueba-sesion/iniciar')
      .set('Cookie', `${NOMBRE}=${t1}`)
      .expect(201);
    expect(await s.h.prisma.sesionPrueba.count()).toBe(1);
    const viejo = await http()
      .get('/portal/prueba-sesion/estado')
      .set('Cookie', `${NOMBRE}=${t1}`)
      .expect(200);
    expect(viejo.body.activa).toBe(false);
  });

  it('en producción (RAILWAY_PROJECT_NAME=aelika-production) los tres endpoints responden 404 y no tocan la base', async () => {
    process.env.RAILWAY_PROJECT_NAME = 'aelika-production';
    await http().post('/portal/prueba-sesion/iniciar').expect(404);
    await http().get('/portal/prueba-sesion/estado').expect(404);
    await http().post('/portal/prueba-sesion/cerrar').expect(404);
    expect(await s.h.prisma.sesionPrueba.count()).toBe(0);
  });

  it('en otro proyecto de Railway (staging) están habilitados', async () => {
    process.env.RAILWAY_PROJECT_NAME = 'aelika-staging';
    await http().get('/portal/prueba-sesion/estado').expect(200);
  });
});
