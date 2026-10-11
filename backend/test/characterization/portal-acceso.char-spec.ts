import { Logger } from '@nestjs/common';
import request from 'supertest';
import { seedBase } from './db';
import { usarSuite } from './helpers';
import { crearClienteB2b } from '../../src/clientes/cliente-b2b';

// Fase 4 · 4b · acceso y sesión del portal del cliente B2B (teléfono → código por WhatsApp → sesión).
describe('Portal · acceso y sesión (4b)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const http = () => request(s.h.app.getHttpServer());
  const MENSAJE =
    'Si tu número está dado de alta, recibirás un código por WhatsApp. Si no te llega en unos minutos, contáctanos';
  const TEL = '3331006915';
  const H = { 'x-portal-request': '1' };

  const entorno = { ...process.env };
  beforeEach(() => {
    process.env.PORTAL_CODIGO_EN_LOG = 'true';
    delete process.env.RAILWAY_PROJECT_NAME;
    delete process.env.PORTAL_TOPE_DIARIO_NEGOCIO;
  });
  afterEach(() => {
    process.env = { ...entorno };
    jest.restoreAllMocks();
  });

  const slug = () => s.base.tenant.slug;
  const cookieSesion = (sl = slug()) => `__Host-portal_${sl}`;

  async function alta(
    nombre: string,
    telefonos: string[],
    sufijo = nombre.toLowerCase().replace(/\W+/g, '-'),
  ) {
    return crearClienteB2b(s.h.prisma, {
      tenantId: s.base.tenant.id,
      tenantSlug: slug(),
      sufijo,
      nombre,
      direccion: 'Calle 1',
      telefonos: telefonos.map((telefono, i) => ({
        telefono,
        principal: i === 0,
      })),
    });
  }

  const pedir = (
    telefono = TEL,
    extra: { cookie?: string; ip?: string; sl?: string } = {},
  ) => {
    let r = http().post('/portal/acceso/pedir-codigo').set(H);
    if (extra.cookie) r = r.set('Cookie', extra.cookie);
    if (extra.ip) r = r.set('x-forwarded-for', extra.ip);
    return r.send({ slug: extra.sl ?? slug(), telefono });
  };
  const verificar = (codigo: string, telefono = TEL, sl = slug()) =>
    http()
      .post('/portal/acceso/verificar')
      .set(H)
      .send({ slug: sl, telefono, codigo });

  /** Código enviado en la última llamada al envío simulado (la respuesta HTTP nunca lo trae). */
  const ultimoCodigo = () => {
    const calls = s.h.fakes.enviarCodigoAcceso.mock.calls;
    return calls[calls.length - 1][0].codigo as string;
  };
  const setCookies = (res: request.Response) =>
    (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const cookieDe = (res: request.Response, nombre: string) =>
    setCookies(res).find((c) => c.startsWith(`${nombre}=`));
  const valorCookie = (c: string) => c.split(';')[0].split('=')[1];

  async function entrar(telefono = TEL) {
    await pedir(telefono).expect(200);
    const res = await verificar(ultimoCodigo(), telefono).expect(200);
    const c = cookieDe(res, cookieSesion()) as string;
    return { res, cookie: `${cookieSesion()}=${valorCookie(c)}` };
  }
  const sesion = (cookie: string, sl = slug()) =>
    http().get(`/portal/acceso/sesion?slug=${sl}`).set('Cookie', cookie);

  describe('flujo completo', () => {
    it('pedir código → verificar → sesión → cerrar', async () => {
      const c = await alta('Café Aurora', [TEL]);

      const p = await pedir().expect(200);
      expect(p.body).toEqual({ ok: true, mensaje: MENSAJE });
      expect(p.headers['cache-control']).toBe('no-store');
      // El código nunca viaja en la respuesta.
      expect(JSON.stringify(p.body)).not.toContain(ultimoCodigo());
      expect(s.h.fakes.enviarCodigoAcceso).toHaveBeenCalledTimes(1);
      expect(s.h.fakes.enviarCodigoAcceso.mock.calls[0][0]).toMatchObject({
        telefono: TEL,
        tenantSlug: slug(),
      });
      expect(ultimoCodigo()).toMatch(/^\d{6}$/);
      // Dispositivo: cookie propia emitida por el servidor.
      expect(cookieDe(p, '__Host-portal_disp')).toMatch(
        /HttpOnly.*Secure|Secure.*HttpOnly/i,
      );

      const v = await verificar(ultimoCodigo()).expect(200);
      expect(v.body).toEqual({ ok: true, requiereSeleccion: false });
      const ck = cookieDe(v, cookieSesion()) as string;
      expect(ck).toMatch(/;\s*HttpOnly/i);
      expect(ck).toMatch(/;\s*Secure/i);
      expect(ck).toMatch(/;\s*SameSite=Lax/i);
      expect(ck).toMatch(/;\s*Path=\//i);
      expect(ck).toMatch(/Max-Age=7776000/);
      expect(ck).not.toMatch(/Domain=/i);
      const token = valorCookie(ck);
      const fila = await s.h.prisma.sesionPortal.findFirstOrThrow();
      expect(fila).toMatchObject({
        telefono: TEL,
        clienteId: c.id,
        tenantId: s.base.tenant.id,
      });
      expect(fila.tokenHash).not.toBe(token); // solo se guarda el hash

      const ses = await sesion(`${cookieSesion()}=${token}`).expect(200);
      expect(ses.body).toEqual({
        negocio: { nombre: `Negocio ${slug()}` },
        telefonoTerminacion: '6915',
        cliente: { id: c.id, nombre: 'Café Aurora' },
        clientes: [{ id: c.id, nombre: 'Café Aurora' }],
        requiereSeleccion: false,
      });
      expect(cookieDe(ses, cookieSesion())).toMatch(/Max-Age=7776000/); // se renueva en cada uso

      const cerrar = await http()
        .post('/portal/acceso/cerrar')
        .set(H)
        .set('Cookie', `${cookieSesion()}=${token}`)
        .send({ slug: slug() })
        .expect(200);
      expect(cookieDe(cerrar, cookieSesion())).toMatch(
        /Expires=Thu, 01 Jan 1970/i,
      );
      expect(await s.h.prisma.sesionPortal.count()).toBe(0);
      await sesion(`${cookieSesion()}=${token}`).expect(401);
    });

    it('la renovación extiende el vencimiento de la sesión', async () => {
      await alta('Café Aurora', [TEL]);
      const { cookie } = await entrar();
      const f0 = await s.h.prisma.sesionPortal.findFirstOrThrow();
      jest.setSystemTime(
        new Date(f0.creadaAt.getTime() + 10 * 24 * 3600 * 1000),
      );
      await sesion(cookie).expect(200);
      const f1 = await s.h.prisma.sesionPortal.findFirstOrThrow();
      expect(f1.venceAt.getTime() - f0.venceAt.getTime()).toBe(
        10 * 24 * 3600 * 1000,
      );
    });

    it('el teléfono se normaliza (lada, espacios y guiones)', async () => {
      await alta('Café Aurora', [TEL]);
      await pedir('+52 33 3100-6915').expect(200);
      await verificar(ultimoCodigo(), '(33) 3100 6915').expect(200);
    });
  });

  describe('sin revelar qué teléfonos son clientes', () => {
    it('un teléfono inexistente recibe exactamente la misma respuesta y no se genera código ni envío', async () => {
      await alta('Café Aurora', [TEL]);
      const real = await pedir(TEL).expect(200);
      const falso = await pedir('5599998888').expect(200);
      expect(falso.body).toEqual(real.body);
      expect(falso.status).toBe(real.status);
      expect(s.h.fakes.enviarCodigoAcceso).toHaveBeenCalledTimes(1); // solo el real
      await verificar('123456', '5599998888').expect(401); // no hay código para él
    });

    it('un cliente dado de baja se comporta como un teléfono inexistente', async () => {
      const c = await alta('Café Aurora', [TEL]);
      await s.h.prisma.cliente.update({
        where: { id: c.id },
        data: { bajaAt: new Date() },
      });
      const r = await pedir().expect(200);
      expect(r.body).toEqual({ ok: true, mensaje: MENSAJE });
      expect(s.h.fakes.enviarCodigoAcceso).not.toHaveBeenCalled();
    });

    it('un teléfono de otro negocio no entra en este', async () => {
      const otro = await seedBase(s.h.prisma, {
        slug: 'otro-mayoreo',
        tipoStorefront: 'RETAIL_B2B',
      });
      await crearClienteB2b(s.h.prisma, {
        tenantId: otro.tenant.id,
        tenantSlug: otro.tenant.slug,
        sufijo: 'x',
        nombre: 'Ajeno',
        direccion: 'Calle',
        telefonos: [{ telefono: TEL, principal: true }],
      });
      await pedir().expect(200);
      expect(s.h.fakes.enviarCodigoAcceso).not.toHaveBeenCalled();
    });

    it('slug inexistente o de menudeo → 404', async () => {
      await pedir(TEL, { sl: 'no-existe' }).expect(404);
      const b2c = await seedBase(s.h.prisma, { slug: 'menudeo-uno' });
      await pedir(TEL, { sl: b2c.tenant.slug }).expect(404);
    });
  });

  describe('validaciones de entrada', () => {
    it('teléfono corto → 400; código que no son 6 dígitos → 400; sin encabezado del portal → 400', async () => {
      await pedir('333100').expect(400);
      await verificar('12ab').expect(400);
      await http()
        .post('/portal/acceso/pedir-codigo')
        .send({ slug: slug(), telefono: TEL })
        .expect(400);
      await http()
        .post('/portal/acceso/cerrar')
        .send({ slug: slug() })
        .expect(400);
    });
  });

  describe('código: un solo uso, vigencia e intentos', () => {
    it('se invalida al usarse', async () => {
      await alta('Café Aurora', [TEL]);
      await pedir().expect(200);
      const codigo = ultimoCodigo();
      await verificar(codigo).expect(200);
      await verificar(codigo).expect(401);
    });

    it('vence a los 10 minutos', async () => {
      await alta('Café Aurora', [TEL]);
      await pedir().expect(200);
      jest.setSystemTime(new Date(Date.now() + 10 * 60 * 1000 + 1000));
      const r = await verificar(ultimoCodigo()).expect(401);
      expect(r.body.message).toMatch(/venció/);
    });

    it('un código nuevo reemplaza al anterior', async () => {
      await alta('Café Aurora', [TEL]);
      await pedir().expect(200);
      const viejo = ultimoCodigo();
      await pedir().expect(200);
      const nuevo = ultimoCodigo();
      if (viejo !== nuevo) await verificar(viejo).expect(401);
      await verificar(nuevo).expect(200);
    });

    it('5 intentos por código: al agotarlos el código correcto ya no sirve', async () => {
      await alta('Café Aurora', [TEL]);
      await pedir().expect(200);
      const bueno = ultimoCodigo();
      const malo = bueno === '000000' ? '111111' : '000000';
      for (let i = 0; i < 4; i += 1) {
        const r = await verificar(malo).expect(401);
        expect(r.body.message).toBe('Código incorrecto');
      }
      const quinto = await verificar(malo).expect(401);
      expect(quinto.body.message).toMatch(/Agotaste/);
      await verificar(bueno).expect(401);
      expect(await s.h.prisma.sesionPortal.count()).toBe(0);
    });
  });

  describe('límites de envío', () => {
    it('3 por hora por teléfono; 10 por día', async () => {
      await alta('Café Aurora', [TEL]);
      const t0 = Date.now();
      for (let i = 0; i < 3; i += 1) await pedir().expect(200);
      const r = await pedir().expect(429);
      expect(r.body.message).toMatch(/demasiados códigos/i);

      // Los intentos bloqueados también cuentan: 4 en la primera hora + 3 + 3 = 10 intentos del día.
      for (const h of [1.1, 2.2]) {
        jest.setSystemTime(new Date(t0 + h * 3600 * 1000));
        for (let i = 0; i < 3; i += 1) await pedir().expect(200);
      }
      jest.setSystemTime(new Date(t0 + 3.3 * 3600 * 1000));
      await pedir().expect(429); // pasó el límite del día aunque la hora está libre
      // Al día siguiente vuelve a permitir.
      jest.setSystemTime(new Date(t0 + 25 * 3600 * 1000));
      await pedir().expect(200);
    });

    it('10 por día por dispositivo (aunque cambie el teléfono)', async () => {
      await alta('Café Aurora', [TEL]);
      const disp = '__Host-portal_disp=11111111-1111-4111-8111-111111111111';
      for (let i = 0; i < 10; i += 1) {
        await pedir(`33310069${String(10 + i)}`, {
          cookie: disp,
          ip: `10.0.0.${i}`,
        }).expect(200);
      }
      await pedir('3331006999', { cookie: disp, ip: '10.0.1.1' }).expect(429);
      // Otro dispositivo sí puede.
      await pedir('3331006999', {
        cookie: '__Host-portal_disp=22222222-2222-4222-8222-222222222222',
        ip: '10.0.1.2',
      }).expect(200);
    });

    it('30 por día por IP', async () => {
      for (let i = 0; i < 30; i += 1) {
        await pedir(`5500000${String(100 + i)}`, {
          cookie: `__Host-portal_disp=00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          ip: '200.1.1.1',
        }).expect(200);
      }
      await pedir('5500000999', {
        cookie: '__Host-portal_disp=00000000-0000-4000-8000-999999999999',
        ip: '200.1.1.1',
      }).expect(429);
    });

    it('tope diario por negocio', async () => {
      process.env.PORTAL_TOPE_DIARIO_NEGOCIO = '2';
      const nuevo = (i: number) => ({
        cookie: `__Host-portal_disp=00000000-0000-4000-8000-00000000000${i}`,
        ip: `9.9.9.${i}`,
      });
      await pedir('5511111111', nuevo(1)).expect(200);
      await pedir('5522222222', nuevo(2)).expect(200);
      await pedir('5533333333', nuevo(3)).expect(429);
    });

    it('los teléfonos que no son clientes también cuentan', async () => {
      for (let i = 0; i < 3; i += 1) await pedir('5599998888').expect(200);
      await pedir('5599998888').expect(429);
    });
  });

  describe('Redis caído: falla cerrado', () => {
    it('pedir y verificar responden 503 y no se envía nada', async () => {
      await alta('Café Aurora', [TEL]);
      s.h.fakes.codigos.caido = true;
      const p = await pedir().expect(503);
      expect(p.body.message).not.toMatch(/redis/i);
      await verificar('123456').expect(503);
      expect(s.h.fakes.enviarCodigoAcceso).not.toHaveBeenCalled();
      expect(await s.h.prisma.sesionPortal.count()).toBe(0);
    });
  });

  describe('código visible (solo pruebas)', () => {
    it('con la variable activa fuera de producción el código aparece en el registro', async () => {
      await alta('Café Aurora', [TEL]);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      await pedir().expect(200);
      const lineas = warn.mock.calls.map((c) => String(c[0]));
      expect(lineas.some((l) => l.includes(`codigo=${ultimoCodigo()}`))).toBe(
        true,
      );
      // El teléfono sale enmascarado.
      expect(lineas.join('\n')).not.toContain(TEL);
    });

    it('sin la variable, el código nunca se escribe en el registro', async () => {
      process.env.PORTAL_CODIGO_EN_LOG = 'false';
      await s.h.prisma.tenant.update({
        where: { id: s.base.tenant.id },
        data: {
          portalPlantillaNombre: 'codigo_acceso',
          portalPlantillaIdioma: 'es_MX',
          botWebhookUrl: 'https://bp.test/hook',
        },
      });
      await alta('Café Aurora', [TEL]);
      const spies = [
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(),
        jest.spyOn(Logger.prototype, 'log').mockImplementation(),
        jest.spyOn(Logger.prototype, 'error').mockImplementation(),
        jest.spyOn(Logger.prototype, 'debug').mockImplementation(),
      ];
      await pedir().expect(200);
      const codigo = ultimoCodigo();
      for (const sp of spies)
        expect(sp.mock.calls.map((c) => String(c[0])).join('\n')).not.toContain(
          codigo,
        );
    });

    it('en producción la variable se ignora: sin plantilla el acceso queda inerte (ni código ni límites)', async () => {
      process.env.RAILWAY_PROJECT_NAME = 'aelika-production';
      process.env.PORTAL_CODIGO_EN_LOG = 'true';
      await alta('Café Aurora', [TEL]);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const r = await pedir().expect(200);
      expect(r.body).toEqual({ ok: true, mensaje: MENSAJE });
      expect(s.h.fakes.enviarCodigoAcceso).not.toHaveBeenCalled();
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(
        /codigo=\d{6}/,
      );
      // Tampoco consumió límites: los 3 siguientes de ese teléfono no se acumulan.
      for (let i = 0; i < 5; i += 1) await pedir().expect(200);
    });

    it('en producción con plantilla y webhook sí envía por WhatsApp, y sin escribir el código en el registro', async () => {
      process.env.RAILWAY_PROJECT_NAME = 'aelika-production';
      process.env.PORTAL_CODIGO_EN_LOG = 'true';
      await s.h.prisma.tenant.update({
        where: { id: s.base.tenant.id },
        data: {
          portalPlantillaNombre: 'codigo_acceso',
          portalPlantillaIdioma: 'es_MX',
          botWebhookUrl: 'https://bp.test/hook',
        },
      });
      await alta('Café Aurora', [TEL]);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      await pedir().expect(200);
      expect(s.h.fakes.enviarCodigoAcceso).toHaveBeenCalledTimes(1);
      expect(s.h.fakes.enviarCodigoAcceso.mock.calls[0][0]).toMatchObject({
        plantillaNombre: 'codigo_acceso',
        plantillaIdioma: 'es_MX',
        botWebhookUrl: 'https://bp.test/hook',
      });
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).not.toContain(
        ultimoCodigo(),
      );
    });
  });

  describe('revalidación en cada petición', () => {
    it('dar de baja al cliente termina la sesión (401, cookie borrada y fila eliminada)', async () => {
      const c = await alta('Café Aurora', [TEL]);
      const { cookie } = await entrar();
      await sesion(cookie).expect(200);
      await s.h.prisma.cliente.update({
        where: { id: c.id },
        data: { bajaAt: new Date() },
      });
      const r = await sesion(cookie).expect(401);
      expect(cookieDe(r, cookieSesion())).toMatch(/Expires=Thu, 01 Jan 1970/i);
      expect(await s.h.prisma.sesionPortal.count()).toBe(0);
    });

    it('quitarle el teléfono al cliente termina la sesión', async () => {
      const c = await alta('Café Aurora', [TEL, '5544445555']);
      const { cookie } = await entrar();
      await s.h.prisma.clienteTelefono.deleteMany({
        where: { clienteId: c.id, telefono: TEL },
      });
      await sesion(cookie).expect(401);
    });

    it('la sesión es de un teléfono, no de otro del mismo cliente', async () => {
      await alta('Café Aurora', [TEL, '5544445555']);
      const { cookie } = await entrar('5544445555');
      await s.h.prisma.clienteTelefono.deleteMany({ where: { telefono: TEL } });
      await sesion(cookie).expect(200); // su teléfono sigue autorizado
    });

    it('una sesión vencida ya no sirve', async () => {
      await alta('Café Aurora', [TEL]);
      const { cookie } = await entrar();
      const f = await s.h.prisma.sesionPortal.findFirstOrThrow();
      jest.setSystemTime(new Date(f.venceAt.getTime() + 1000));
      await sesion(cookie).expect(401);
    });

    it('la cookie de un negocio no sirve en otro', async () => {
      await alta('Café Aurora', [TEL]);
      const otro = await seedBase(s.h.prisma, {
        slug: 'otro-mayoreo',
        tipoStorefront: 'RETAIL_B2B',
      });
      const { cookie } = await entrar();
      const token = cookie.split('=')[1];
      await sesion(
        `__Host-portal_${otro.tenant.slug}=${token}`,
        otro.tenant.slug,
      ).expect(401);
    });

    it('sin cookie → 401 sin Set-Cookie', async () => {
      const r = await http()
        .get(`/portal/acceso/sesion?slug=${slug()}`)
        .expect(401);
      expect(cookieDe(r, cookieSesion())).toBeUndefined();
    });
  });

  describe('teléfono en varios clientes', () => {
    it('verificar pide elegir; elegir fija el cliente; cambiar de cliente; uno ajeno → 404', async () => {
      const a = await alta('Sucursal Centro', [TEL], 'centro');
      const b = await alta('Sucursal Norte', [TEL, '5544445555'], 'norte');
      const ajeno = await alta('Otro Cliente', ['5500001111'], 'ajeno');
      await pedir().expect(200);
      const v = await verificar(ultimoCodigo()).expect(200);
      expect(v.body).toEqual({ ok: true, requiereSeleccion: true });
      const cookie = `${cookieSesion()}=${valorCookie(cookieDe(v, cookieSesion()) as string)}`;

      const antes = await sesion(cookie).expect(200);
      expect(antes.body.cliente).toBeNull();
      expect(antes.body.requiereSeleccion).toBe(true);
      expect(antes.body.clientes.map((c: any) => c.nombre)).toEqual([
        'Sucursal Centro',
        'Sucursal Norte',
      ]);

      const elegir = (clienteId: string) =>
        http()
          .post('/portal/acceso/cliente')
          .set(H)
          .set('Cookie', cookie)
          .send({ slug: slug(), clienteId });
      await elegir(a.id).expect(200);
      expect((await sesion(cookie).expect(200)).body.cliente).toEqual({
        id: a.id,
        nombre: 'Sucursal Centro',
      });
      await elegir(b.id).expect(200);
      expect((await sesion(cookie).expect(200)).body.cliente.id).toBe(b.id);
      await elegir(ajeno.id).expect(404);
    });

    it('si el cliente activo pierde al teléfono pero queda otro, la sesión sigue y vuelve a la selección', async () => {
      const a = await alta('Sucursal Centro', [TEL], 'centro');
      await alta('Sucursal Norte', [TEL], 'norte');
      await alta('Sucursal Sur', [TEL], 'sur');
      await pedir().expect(200);
      const v = await verificar(ultimoCodigo()).expect(200);
      const cookie = `${cookieSesion()}=${valorCookie(cookieDe(v, cookieSesion()) as string)}`;
      await http()
        .post('/portal/acceso/cliente')
        .set(H)
        .set('Cookie', cookie)
        .send({ slug: slug(), clienteId: a.id });

      await s.h.prisma.cliente.update({
        where: { id: a.id },
        data: { bajaAt: new Date() },
      });
      const r = await sesion(cookie).expect(200);
      expect(r.body.cliente).toBeNull();
      expect(r.body.requiereSeleccion).toBe(true);
      expect(r.body.clientes).toHaveLength(2);
    });

    it('si de varios queda uno solo, queda elegido', async () => {
      await alta('Sucursal Centro', [TEL], 'centro');
      const b = await alta('Sucursal Norte', [TEL], 'norte');
      const { cookie } = await entrar();
      await s.h.prisma.clienteTelefono.deleteMany({
        where: { clienteId: { not: b.id }, telefono: TEL },
      });
      const r = await sesion(cookie).expect(200);
      expect(r.body.cliente.id).toBe(b.id);
    });
  });
});
