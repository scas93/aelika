import request from 'supertest';
import { seedCodigoDescuento } from './db';
import { expectError } from './exacto';
import { usarSuite } from './helpers';
import {
  apiRol,
  bodyB2b,
  crearPublicoB2b,
  cuerpoPanelB2b,
} from './b2b-helpers';

// 0b-1 · Área 9 · Permisos por rol en todos los endpoints B2B del panel.
// Lecturas: los 3 roles. Crear, marcar-pagado, corregir y códigos POST/PATCH/DELETE: Gerente y Dueño.
// Editar (items), confirmar (avanzar) y cancelar: los 3 roles (el Operador no puede sobre un pedido Pagado: ver b2b-pagos-correccion).
describe('B2B · permisos por rol', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const SIN_PERMISO = 'No tienes permiso para realizar esta acción';
  type Rol = 'DUENO' | 'GERENTE' | 'OPERADOR';
  const roles: Rol[] = ['OPERADOR', 'GERENTE', 'DUENO'];
  const anon = () => request(s.h.app.getHttpServer());

  describe('lecturas: abiertas a los 3 roles; sin token 401', () => {
    it.each([
      ['/pedidos-b2b'],
      ['/pedidos-b2b/resumen'],
      ['/pedidos-b2b/export'],
      ['/pedidos-b2b/dia/2026-09-30'],
      ['/pedidos-b2b/dia/2026-09-30/export'],
      ['/codigos-descuento-b2b'],
    ])('GET %s', async (ruta) => {
      for (const rol of roles) {
        const res = await apiRol(s.h, s.base, rol).get(ruta);
        expect([rol, res.status]).toStrictEqual([rol, 200]);
      }
      expectError(await anon().get(ruta), 401, 'Unauthorized');
    });

    it('GET /pedidos-b2b/:id', async () => {
      const p = await crearPublicoB2b(s.h, s.base);
      for (const rol of roles) {
        expect([
          rol,
          (await apiRol(s.h, s.base, rol).get(`/pedidos-b2b/${p.id}`)).status,
        ]).toStrictEqual([rol, 200]);
      }
      expectError(
        await anon().get(`/pedidos-b2b/${p.id}`),
        401,
        'Unauthorized',
      );
    });
  });

  describe('escrituras de pedidos de admin: Operador 403 (sin efectos), Gerente y Dueño permitidos, sin token 401', () => {
    // Fase 2: crear un pedido (captura por teléfono) está abierto a los 3 roles; antes el Operador recibía 403.
    it('POST /pedidos-b2b: los 3 roles pueden crear; sin token 401', async () => {
      for (const [i, rol] of roles.entries()) {
        const res = await apiRol(s.h, s.base, rol).post(
          '/pedidos-b2b',
          await cuerpoPanelB2b(s.h, s.base, {
            contactoTelefono: `550000000${i}`,
          }),
        );
        expect([rol, res.status]).toStrictEqual([rol, 201]);
      }
      expectError(
        await anon().post('/pedidos-b2b').send(bodyB2b(s.base)),
        401,
        'Unauthorized',
      );
    });

    const escrituras: [
      string,
      (id: string) => { metodo: 'patch'; url: string; body?: object },
    ][] = [
      [
        'marcar-pagado',
        (id) => ({ metodo: 'patch', url: `/pedidos-b2b/${id}/marcar-pagado` }),
      ],
    ];
    it.each(escrituras)('PATCH /pedidos-b2b/:id/%s', async (_nombre, ruta) => {
      const armar = (id: string) => {
        const r = ruta(id);
        if (r.body && 'items' in r.body)
          (r.body as any).items[0].productId = s.base.productoA.id;
        return r;
      };
      const antes = await crearPublicoB2b(s.h, s.base);
      const r0 = armar(antes.id);
      const op = apiRol(s.h, s.base, 'OPERADOR').patch(r0.url);
      expectError(
        r0.body ? await op.send(r0.body) : await op,
        403,
        SIN_PERMISO,
      );
      const fila = await s.h.prisma.order.findUniqueOrThrow({
        where: { id: antes.id },
      });
      expect({
        estado: fila.estadoPedido,
        estadoPago: fila.estadoPago,
        cancelado: fila.cancelado,
      }).toStrictEqual({
        estado: 'PENDIENTE_CONFIRMACION',
        estadoPago: 'PENDIENTE',
        cancelado: false,
      });
      expectError(
        r0.body
          ? await anon().patch(r0.url).send(r0.body)
          : await anon().patch(r0.url),
        401,
        'Unauthorized',
      );

      for (const [i, rol] of (['GERENTE', 'DUENO'] as Rol[]).entries()) {
        const p = await crearPublicoB2b(s.h, s.base, {
          contactoTelefono: `55000000${i}0`,
        });
        const r = armar(p.id);
        const llamada = apiRol(s.h, s.base, rol).patch(r.url);
        const res = r.body ? await llamada.send(r.body) : await llamada;
        expect([rol, res.status]).toStrictEqual([rol, 200]);
      }
    });
  });

  describe('editar, confirmar y cancelar: abiertas a los 3 roles (sin token 401)', () => {
    const operaciones: [
      string,
      (id: string, productId: string) => { url: string; body?: object },
    ][] = [
      [
        'items',
        (id, productId) => ({
          url: `/pedidos-b2b/${id}/items`,
          body: {
            items: [
              { productId, distribucion: [{ dia: 'LUNES', cantidad: 12 }] },
            ],
          },
        }),
      ],
      ['avanzar', (id) => ({ url: `/pedidos-b2b/${id}/avanzar` })],
      ['cancelar', (id) => ({ url: `/pedidos-b2b/${id}/cancelar` })],
    ];
    it.each(operaciones)('PATCH /pedidos-b2b/:id/%s', async (_nombre, ruta) => {
      const anonimo = ruta('x', s.base.productoA.id);
      expectError(
        anonimo.body
          ? await anon().patch(anonimo.url).send(anonimo.body)
          : await anon().patch(anonimo.url),
        401,
        'Unauthorized',
      );
      for (const [i, rol] of roles.entries()) {
        const p = await crearPublicoB2b(s.h, s.base, {
          contactoTelefono: `55000001${i}0`,
        });
        const r = ruta(p.id, s.base.productoA.id);
        const llamada = apiRol(s.h, s.base, rol).patch(r.url);
        const res = r.body ? await llamada.send(r.body) : await llamada;
        expect([rol, res.status]).toStrictEqual([rol, 200]);
      }
    });
  });

  describe('códigos de descuento: escritura solo Gerente/Dueño (ver también b2b-codigos)', () => {
    it('POST/PATCH/DELETE: Operador 403 y sin token 401; Gerente y Dueño permitidos', async () => {
      const c = await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, {
        codigo: 'UNO',
      });
      expectError(
        await apiRol(s.h, s.base, 'OPERADOR').post('/codigos-descuento-b2b', {
          codigo: 'NUEVO',
          descuentoPorcentaje: 5,
        }),
        403,
        SIN_PERMISO,
      );
      expectError(
        await apiRol(s.h, s.base, 'OPERADOR')
          .patch(`/codigos-descuento-b2b/${c.id}`)
          .send({ activo: false }),
        403,
        SIN_PERMISO,
      );
      expectError(
        await apiRol(s.h, s.base, 'OPERADOR').delete(
          `/codigos-descuento-b2b/${c.id}`,
        ),
        403,
        SIN_PERMISO,
      );
      expectError(
        await anon().delete(`/codigos-descuento-b2b/${c.id}`),
        401,
        'Unauthorized',
      );

      expect(
        (
          await apiRol(s.h, s.base, 'GERENTE').post('/codigos-descuento-b2b', {
            codigo: 'GER',
            descuentoPorcentaje: 5,
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await apiRol(s.h, s.base, 'GERENTE')
            .patch(`/codigos-descuento-b2b/${c.id}`)
            .send({ activo: false })
        ).status,
      ).toBe(200);
      expect(
        (
          await apiRol(s.h, s.base, 'DUENO').post('/codigos-descuento-b2b', {
            codigo: 'DUE',
            descuentoPorcentaje: 5,
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await apiRol(s.h, s.base, 'DUENO').delete(
            `/codigos-descuento-b2b/${c.id}`,
          )
        ).status,
      ).toBe(200);
    });
  });

  describe('endpoints públicos del storefront: sin JWT', () => {
    it('info, catálogo y vista previa responden sin token', async () => {
      await seedCodigoDescuento(s.h.prisma, s.base.tenant.id, {
        codigo: 'PROMO10',
      });
      const base = `/public/pedidos-b2b/tenants/${s.base.tenant.slug}`;
      expect((await anon().get(base)).status).toBe(200);
      expect((await anon().get(`${base}/catalog`)).status).toBe(200);
      expect(
        (await anon().get(`${base}/codigos-descuento/PROMO10`)).status,
      ).toBe(200);
      // Fase 2: el POST público de pedidos está cerrado (409 con mensaje); ya no crea pedidos.
      expect(
        (await anon().post(`${base}/pedidos`).send(bodyB2b(s.base))).status,
      ).toBe(409);
    });
  });
});
