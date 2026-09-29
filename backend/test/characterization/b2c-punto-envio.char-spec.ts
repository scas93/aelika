import request from 'supertest';
import { tokenFor } from './auth';
import { seedPuntoEnvio } from './db';
import { expectError } from './exacto';
import { auth, bodyCheckout, postCheckout, usarSuite } from './helpers';
import { waitForCalls } from './harness';

// Área 10 · Punto de envío con pedidos: borrarlo da 409. (Los cascades de OrderItem/Payment y el
// Restrict de Cliente quedan fuera de la suite: no tienen endpoint y dependen de la forma de las tablas.)
describe('B2C · punto de envío con pedidos', () => {
  const s = usarSuite();
  const dueno = () => auth(s.h, tokenFor(s.h.jwt, s.base.dueno, s.base.tenant.id, 'DUENO'));

  async function pedidoADomicilio(puntoId: string) {
    const res = await postCheckout(
      s.h,
      s.base.tenant.slug,
      bodyCheckout(s.base, {
        metodoEntrega: 'DOMICILIO',
        puntoEnvioId: puntoId,
        direccionCalle: 'Calle Roble',
        direccionNumero: '12',
        direccionColonia: 'Del Valle',
      }),
    );
    expect(res.status).toBe(201);
    await waitForCalls(s.h.fakes.queueAdd);
    return res.body;
  }

  it('DELETE de un punto con pedidos: 409 y el punto sigue existiendo', async () => {
    const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
    await pedidoADomicilio(punto.id);

    expectError(await dueno().delete(`/puntos-envio/${punto.id}`), 409, 'No puedes eliminar un punto de envío que tiene pedidos');
    expect(await s.h.prisma.puntoEnvio.count()).toBe(1);
  });

  it('DELETE de un punto sin pedidos: se elimina', async () => {
    const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
    const ok = await dueno().delete(`/puntos-envio/${punto.id}`).expect(200);
    expect(ok.body).toStrictEqual({});
    expect(await s.h.prisma.puntoEnvio.count()).toBe(0);
  });

  it('un punto DESACTIVADO con pedidos históricos tampoco se puede borrar (409), pero sí deja de ofrecerse', async () => {
    const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
    await pedidoADomicilio(punto.id);
    await s.h.prisma.puntoEnvio.update({ where: { id: punto.id }, data: { activo: false } });
    expectError(await dueno().delete(`/puntos-envio/${punto.id}`), 409, 'No puedes eliminar un punto de envío que tiene pedidos');
    const publica = await request(s.h.app.getHttpServer()).get(`/public/tenants/${s.base.tenant.slug}/puntos-envio`).expect(200);
    expect(publica.body).toEqual([]);
  });

  it('solo el Dueño puede borrar: Operador y Gerente 403; sin token 401', async () => {
    const punto = await seedPuntoEnvio(s.h.prisma, s.base.tenant.id);
    const sinPermiso = 'No tienes permiso para realizar esta acción';
    expectError(await auth(s.h, tokenFor(s.h.jwt, s.base.operador, s.base.tenant.id, 'OPERADOR')).delete(`/puntos-envio/${punto.id}`), 403, sinPermiso);
    expectError(await auth(s.h, tokenFor(s.h.jwt, s.base.dueno, s.base.tenant.id, 'GERENTE')).delete(`/puntos-envio/${punto.id}`), 403, sinPermiso);
    expectError(await request(s.h.app.getHttpServer()).delete(`/puntos-envio/${punto.id}`), 401, 'Unauthorized');
    expect(await s.h.prisma.puntoEnvio.count()).toBe(1);
  });

  it('DELETE de un id inexistente: 404', async () => {
    expectError(await dueno().delete('/puntos-envio/00000000-0000-4000-8000-000000000000'), 404, 'Punto de envío no encontrado');
  });

  it('GET público lista solo los activos con forma { id, nombre, direccion, pedidoMinimo }', async () => {
    await seedPuntoEnvio(s.h.prisma, s.base.tenant.id, { nombre: 'Zona Norte', direccion: 'Norte 1', pedidoMinimo: '150.00' });
    await seedPuntoEnvio(s.h.prisma, s.base.tenant.id, { nombre: 'Zona Sur', direccion: 'Sur 2', pedidoMinimo: null });
    await seedPuntoEnvio(s.h.prisma, s.base.tenant.id, { nombre: 'Zona Vieja', activo: false });
    const res = await request(s.h.app.getHttpServer()).get(`/public/tenants/${s.base.tenant.slug}/puntos-envio`).expect(200);
    expect(res.body.map(({ id, ...r }: any) => r)).toEqual([
      { nombre: 'Zona Norte', direccion: 'Norte 1', pedidoMinimo: '150' },
      { nombre: 'Zona Sur', direccion: 'Sur 2', pedidoMinimo: null },
    ]);
    expect(Object.keys(res.body[0]).sort()).toEqual(['direccion', 'id', 'nombre', 'pedidoMinimo']);
  });
});
