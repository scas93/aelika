import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { tokenFor } from './auth';
import { expectError } from './exacto';
import { auth, usarSuite } from './helpers';
import { seedBase } from './db';

// El token solo identifica al usuario: el estado (activo) y el rol se leen de la base en cada petición (JwtStrategy).
describe('Sesión vigente · usuario desactivado, borrado o con rol cambiado', () => {
  const s = usarSuite();
  const SIN_SESION = 'Tu sesión ya no es válida. Inicia sesión de nuevo.';
  const SIN_PERMISO = 'No tienes permiso para realizar esta acción';
  const FALSO_ID = '00000000-0000-4000-8000-000000000000';
  // 401 con mensaje propio: Nest agrega `error: 'Unauthorized'` (el 401 de passport no), así que no usa expectError.
  const expect401 = (res: request.Response, message: string) => {
    expect(res.status).toBe(401);
    expect(res.body).toStrictEqual({ message, error: 'Unauthorized', statusCode: 401 });
  };

  it('token emitido antes de desactivar → 401 en la siguiente petición; reactivado vuelve a funcionar', async () => {
    const token = tokenFor(s.h.jwt, s.base.operador, s.base.tenant.id, 'OPERADOR');
    await auth(s.h, token).get('/orders').expect(200);

    await s.h.prisma.user.update({ where: { id: s.base.operador.id }, data: { activo: false } });
    expect401(await auth(s.h, token).get('/orders'), SIN_SESION);
    expect401(await auth(s.h, token).get('/auth/me'), SIN_SESION);

    await s.h.prisma.user.update({ where: { id: s.base.operador.id }, data: { activo: true } });
    await auth(s.h, token).get('/orders').expect(200);
  });

  it('usuario desactivado no puede volver a iniciar sesión; reactivado sí', async () => {
    const user = await s.h.prisma.user.create({
      data: {
        tenantId: s.base.tenant.id,
        nombre: 'Con clave',
        email: 'conclave@cafe-test.test',
        passwordHash: await bcrypt.hash('clave-segura-1', 4),
        rol: 'GERENTE',
        activo: false,
      },
    });
    const login = () =>
      request(s.h.app.getHttpServer()).post('/auth/login').send({ email: user.email, password: 'clave-segura-1' });
    expect401(await login(), 'Este usuario está desactivado');
    await s.h.prisma.user.update({ where: { id: user.id }, data: { activo: true } });
    const ok = await login();
    expect(ok.status).toBe(201);
    await auth(s.h, ok.body.accessToken).get('/auth/me').expect(200);
  });

  it('usuario borrado o de otro tenant: mismo trato que desactivado (401)', async () => {
    const borrado = await s.h.prisma.user.create({
      data: { tenantId: s.base.tenant.id, nombre: 'Temporal', email: 'temp@cafe-test.test', passwordHash: 'x', rol: 'GERENTE' },
    });
    const token = tokenFor(s.h.jwt, borrado, s.base.tenant.id, 'GERENTE');
    await auth(s.h, token).get('/orders').expect(200);
    await s.h.prisma.user.delete({ where: { id: borrado.id } });
    expect401(await auth(s.h, token).get('/orders'), SIN_SESION);

    const otro = await seedBase(s.h.prisma, { slug: 'otro-negocio' });
    // Token que dice ser de otro tenant pero con un usuario de este: no cuela.
    expect401(await auth(s.h, tokenFor(s.h.jwt, s.base.dueno, otro.tenant.id, 'DUENO')).get('/orders'), SIN_SESION);
  });

  it('bajar de Gerente a Operador: la siguiente petición ya aplica el rol nuevo (reembolso y Catálogo 403)', async () => {
    const token = tokenFor(s.h.jwt, s.base.gerente, s.base.tenant.id, 'GERENTE');
    // Antes: pasa el control de rol (404 por id inexistente / 201 al crear).
    expectError(await auth(s.h, token).post(`/orders/${FALSO_ID}/reembolsar`), 404, 'Pedido no encontrado');
    await auth(s.h, token).post('/categories').send({ nombre: 'Antes' }).expect(201);

    await s.h.prisma.user.update({ where: { id: s.base.gerente.id }, data: { rol: 'OPERADOR' } });

    expectError(await auth(s.h, token).post(`/orders/${FALSO_ID}/reembolsar`), 403, SIN_PERMISO);
    expectError(await auth(s.h, token).post('/categories').send({ nombre: 'Después' }), 403, SIN_PERMISO);
    expectError(await auth(s.h, token).post('/products').send({}), 403, SIN_PERMISO);
    // /auth/me (lo que usa la nav del panel) refleja el mismo rol.
    expect((await auth(s.h, token).get('/auth/me').expect(200)).body.rol).toBe('OPERADOR');
    // Sigue pudiendo lo del Operador.
    await auth(s.h, token).get('/orders').expect(200);
  });

  it('subir de rol aplica de inmediato; un rol falsificado en el token no vale', async () => {
    const tokenOp = tokenFor(s.h.jwt, s.base.operador, s.base.tenant.id, 'OPERADOR');
    expectError(await auth(s.h, tokenOp).get('/tenant/me'), 403, SIN_PERMISO);
    await s.h.prisma.user.update({ where: { id: s.base.operador.id }, data: { rol: 'DUENO' } });
    await auth(s.h, tokenOp).get('/tenant/me').expect(200);

    const falso = tokenFor(s.h.jwt, s.base.gerente, s.base.tenant.id, 'DUENO'); // dice DUENO, en la base es GERENTE
    expectError(await auth(s.h, falso).get('/tenant/me'), 403, SIN_PERMISO);
  });
});
