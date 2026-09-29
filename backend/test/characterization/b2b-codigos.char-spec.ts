import request from 'supertest';
import { seedBase, seedCodigoDescuento } from './db';
import { expectError, expectExacto } from './exacto';
import { usarSuite } from './helpers';
import { apiRol, crearPublicoB2b } from './b2b-helpers';

// 0b-1 · Área 8 · CRUD de códigos de descuento B2B (/codigos-descuento-b2b): GET abierto; POST/PATCH/DELETE Gerente/Dueño.
describe('B2B · códigos de descuento (CRUD)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const api = (rol: 'DUENO' | 'GERENTE' | 'OPERADOR' = 'DUENO') => apiRol(s.h, s.base, rol);
  const et = () => ({ [s.base.tenant.id]: 'tenant' });

  const codigoEsperado = (overrides: Record<string, unknown> = {}) => ({
    id: '<uuid>',
    tenantId: '<tenant>',
    codigo: 'PROMO10',
    descuentoPorcentaje: '10',
    activo: true,
    usosMaximos: null,
    fechaLimite: null,
    createdAt: '<iso>',
    updatedAt: '<iso>',
    ...overrides,
  });

  describe('GET', () => {
    it('lista con usosActuales derivado (incluye pedidos cancelados), más reciente primero', async () => {
      const a = await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'PRIMERO', porcentaje: '5.00' });
      jest.setSystemTime(new Date('2026-09-30T17:00:00.000Z'));
      await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'SEGUNDO', porcentaje: '15.00', usosMaximos: 3, fechaLimite: '2026-12-31' });
      const p1 = await crearPublicoB2b(s.h, s.base, { codigoDescuento: 'PRIMERO' });
      await crearPublicoB2b(s.h, s.base, { codigoDescuento: 'PRIMERO', contactoTelefono: '5500000001' });
      await api().patch(`/pedidos-b2b/${p1.id}/cancelar`).expect(200);

      const res = await api().get('/codigos-descuento-b2b').expect(200);
      expectExacto(
        res.body,
        [
          codigoEsperado({ codigo: 'SEGUNDO', descuentoPorcentaje: '15', usosMaximos: 3, fechaLimite: '<iso>', usosActuales: 0 }),
          codigoEsperado({ id: '<primero>', codigo: 'PRIMERO', descuentoPorcentaje: '5', usosActuales: 2 }), // el cancelado también cuenta
        ],
        { ...et(), [a.id]: 'primero' },
      );
      expect(res.body[0].fechaLimite).toBe('2026-12-31T00:00:00.000Z'); // @db.Date serializado a medianoche UTC
    });

    it('sin códigos: lista vacía; los 3 roles pueden leer; sin token 401', async () => {
      expect((await api().get('/codigos-descuento-b2b').expect(200)).body).toStrictEqual([]);
      await api('OPERADOR').get('/codigos-descuento-b2b').expect(200);
      await api('GERENTE').get('/codigos-descuento-b2b').expect(200);
      expectError(await request(s.h.app.getHttpServer()).get('/codigos-descuento-b2b'), 401, 'Unauthorized');
    });
  });

  describe('POST', () => {
    it('mínimo: normaliza a mayúsculas, activo por defecto, sin límites', async () => {
      const res = await api().post('/codigos-descuento-b2b', { codigo: 'nuevo-10', descuentoPorcentaje: 12.5 });
      expect(res.status).toBe(201);
      expectExacto(res.body, codigoEsperado({ codigo: 'NUEVO-10', descuentoPorcentaje: '12.5' }), et());
    });

    it('completo: usosMaximos, fecha límite (medianoche UTC) y activo=false', async () => {
      const res = await api('GERENTE').post('/codigos-descuento-b2b', {
        codigo: 'Especial',
        descuentoPorcentaje: 20,
        usosMaximos: 5,
        fechaLimite: '2026-12-31',
        activo: false,
      });
      expect(res.status).toBe(201);
      expectExacto(
        res.body,
        codigoEsperado({ codigo: 'ESPECIAL', descuentoPorcentaje: '20', usosMaximos: 5, fechaLimite: '<iso>', activo: false }),
        et(),
      );
      expect(res.body.fechaLimite).toBe('2026-12-31T00:00:00.000Z'); // @db.Date serializado a medianoche UTC
    });

    it('código duplicado (mismo texto sin importar mayúsculas): 409; el mismo texto en otro tenant sí se permite', async () => {
      await api().post('/codigos-descuento-b2b', { codigo: 'DUP', descuentoPorcentaje: 10 }).expect(201);
      expectError(await api().post('/codigos-descuento-b2b', { codigo: 'dup', descuentoPorcentaje: 5 }), 409, 'Ya existe un código de descuento con ese texto');
      const otro = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
      await seedCodigoDescuento(s.h.prisma, otro.tenant.id, { codigo: 'COMPARTIDO' });
      await api().post('/codigos-descuento-b2b', { codigo: 'COMPARTIDO', descuentoPorcentaje: 5 }).expect(201);
    });

    it('validación: código con caracteres inválidos o corto, descuento fuera de rango, usosMaximos 0, fecha inválida', async () => {
      const cuerpo = (extra: Record<string, unknown>) => api().post('/codigos-descuento-b2b', { codigo: 'OK', descuentoPorcentaje: 10, ...extra });
      expectError(await cuerpo({ codigo: 'con espacio' }), 400, ['El código solo puede contener letras, números, guiones y guiones bajos']);
      expectError(await cuerpo({ codigo: 'a' }), 400, [
        'codigo must be longer than or equal to 2 characters',
      ]);
      expectError(await cuerpo({ descuentoPorcentaje: 101 }), 400, ['descuentoPorcentaje must not be greater than 100']);
      expectError(await cuerpo({ descuentoPorcentaje: 0 }), 400, ['descuentoPorcentaje must be a positive number']);
      expectError(await cuerpo({ usosMaximos: 0 }), 400, ['usosMaximos must be a positive number']);
      expectError(await cuerpo({ fechaLimite: '2026-13-45' }), 400, ['fechaLimite must be a valid ISO 8601 date string']);
      expect(await s.h.prisma.pedidoB2bCodigoDescuento.count()).toBe(0);
    });

    it('permisos: Operador 403, sin token 401', async () => {
      expectError(await api('OPERADOR').post('/codigos-descuento-b2b', { codigo: 'X1', descuentoPorcentaje: 10 }), 403, 'No tienes permiso para realizar esta acción');
      expectError(await request(s.h.app.getHttpServer()).post('/codigos-descuento-b2b').send({ codigo: 'X1', descuentoPorcentaje: 10 }), 401, 'Unauthorized');
    });
  });

  describe('PATCH', () => {
    it('actualiza campos parciales (sin usosActuales en la respuesta) y permite limpiar límites con null', async () => {
      const c = await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'PROMO10', usosMaximos: 5, fechaLimite: '2026-12-31' });
      const a = await api().patch(`/codigos-descuento-b2b/${c.id}`).send({ descuentoPorcentaje: 15, activo: false, codigo: 'nuevo' });
      expect(a.status).toBe(200);
      expectExacto(
        a.body,
        codigoEsperado({ codigo: 'NUEVO', descuentoPorcentaje: '15', activo: false, usosMaximos: 5, fechaLimite: '<iso>' }),
        et(),
      );
      const b = await api().patch(`/codigos-descuento-b2b/${c.id}`).send({ usosMaximos: null, fechaLimite: null });
      expectExacto(b.body, codigoEsperado({ codigo: 'NUEVO', descuentoPorcentaje: '15', activo: false }), et());
    });

    it('rechazos: id inexistente 404, texto duplicado 409, validación 400, permisos', async () => {
      const c = await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'UNO' });
      await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'DOS' });
      expectError(await api().patch('/codigos-descuento-b2b/00000000-0000-4000-8000-000000000000').send({ activo: false }), 404, 'Código de descuento no encontrado');
      expectError(await api().patch(`/codigos-descuento-b2b/${c.id}`).send({ codigo: 'dos' }), 409, 'Ya existe un código de descuento con ese texto');
      expectError(await api().patch(`/codigos-descuento-b2b/${c.id}`).send({ descuentoPorcentaje: 500 }), 400, ['descuentoPorcentaje must not be greater than 100']);
      expectError(await api('OPERADOR').patch(`/codigos-descuento-b2b/${c.id}`).send({ activo: false }), 403, 'No tienes permiso para realizar esta acción');
      expectError(await request(s.h.app.getHttpServer()).patch(`/codigos-descuento-b2b/${c.id}`).send({}), 401, 'Unauthorized');
    });
  });

  describe('DELETE', () => {
    it('borra (200, cuerpo vacío) y un id inexistente da 404', async () => {
      const c = await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'BORRAR' });
      const res = await api().delete(`/codigos-descuento-b2b/${c.id}`).expect(200);
      expect(res.body).toStrictEqual({});
      expect(await s.h.prisma.pedidoB2bCodigoDescuento.count()).toBe(0);
      expectError(await api().delete(`/codigos-descuento-b2b/${c.id}`), 404, 'Código de descuento no encontrado');
    });

    it('borrar un código usado NO rompe los pedidos: conservan texto y % (snapshot) y pierden solo el vínculo', async () => {
      const c = await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'PROMO10', porcentaje: '10.00' });
      const p = await crearPublicoB2b(s.h, s.base, { codigoDescuento: 'PROMO10' });
      await api().delete(`/codigos-descuento-b2b/${c.id}`).expect(200);

      const res = await api().get(`/pedidos-b2b/${p.id}`).expect(200);
      expect({
        codigoDescuentoId: res.body.codigoDescuentoId,
        codigoDescuentoTexto: res.body.codigoDescuentoTexto,
        descuentoPorcentajeAplicado: res.body.descuentoPorcentajeAplicado,
        descuentoTotal: res.body.descuentoTotal,
        total: res.body.total,
        codigoDescuento: res.body.codigoDescuento,
      }).toStrictEqual({
        codigoDescuentoId: null,
        codigoDescuentoTexto: 'PROMO10',
        descuentoPorcentajeAplicado: '10',
        descuentoTotal: '66.2',
        total: '595.8',
        codigoDescuento: null,
      });
    });

    it('permisos: Operador 403, sin token 401', async () => {
      const c = await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, { codigo: 'PROMO10' });
      expectError(await api('OPERADOR').delete(`/codigos-descuento-b2b/${c.id}`), 403, 'No tienes permiso para realizar esta acción');
      expectError(await request(s.h.app.getHttpServer()).delete(`/codigos-descuento-b2b/${c.id}`), 401, 'Unauthorized');
      expect(await s.h.prisma.pedidoB2bCodigoDescuento.count()).toBe(1);
    });
  });
});
