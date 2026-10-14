import request from 'supertest';
import { seedBase } from './db';
import { usarSuite } from './helpers';
import { apiRol, crearAdminB2b } from './b2b-helpers';

// Entrega 2g: ID del ERP del producto (opcional, único por negocio) y mínimo de piezas del negocio en 0.
describe('Catálogo · ID del ERP', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const gerente = () => apiRol(s.h, s.base, 'GERENTE');
  const nuevo = (extra: Record<string, unknown> = {}) =>
    gerente()
      .post('/products')
      .send({
        nombre: 'Pan de prueba',
        precio: 20,
        categoryId: s.base.categoria.id,
        ...extra,
      });

  it('se guarda y se devuelve; vacío o solo espacios = sin ID (null)', async () => {
    const a = await nuevo({ nombre: 'Con ID', erpId: '  ERP-001 ' }).expect(
      201,
    );
    expect(a.body.erpId).toBe('ERP-001');
    for (const erpId of ['', '   ']) {
      const b = await nuevo({ nombre: `Sin ID ${erpId.length}`, erpId }).expect(
        201,
      );
      expect(b.body.erpId).toBeNull();
    }
    const c = await nuevo({ nombre: 'Sin campo' }).expect(201);
    expect(c.body.erpId).toBeNull();
    // varios productos sin ID conviven
    expect(
      await s.h.prisma.product.count({ where: { erpId: null } }),
    ).toBeGreaterThanOrEqual(3);
    const lista = (await gerente().get('/products').expect(200)).body;
    expect(lista.find((p: { id: string }) => p.id === a.body.id).erpId).toBe(
      'ERP-001',
    );
  });

  it('dos productos del mismo negocio no pueden tener el mismo ID del ERP (409 claro), ni al crear ni al editar', async () => {
    const a = await nuevo({ nombre: 'Uno', erpId: 'ERP-X' }).expect(201);
    const dup = await nuevo({ nombre: 'Dos', erpId: 'ERP-X' });
    expect([dup.status, dup.body.message]).toEqual([
      409,
      'Ya existe otro producto con ese ID del ERP',
    ]);
    expect(await s.h.prisma.product.count({ where: { nombre: 'Dos' } })).toBe(
      0,
    );

    const b = await nuevo({ nombre: 'Tres', erpId: 'ERP-Y' }).expect(201);
    const edit = await gerente()
      .patch(`/products/${b.body.id}`)
      .send({ erpId: 'ERP-X' });
    expect([edit.status, edit.body.message]).toEqual([
      409,
      'Ya existe otro producto con ese ID del ERP',
    ]);
    expect(
      (await s.h.prisma.product.findUniqueOrThrow({ where: { id: b.body.id } }))
        .erpId,
    ).toBe('ERP-Y');

    // editar sin tocar el ID (o con su mismo ID) no choca consigo mismo
    await gerente()
      .patch(`/products/${a.body.id}`)
      .send({ nombre: 'Uno renombrado', erpId: 'ERP-X' })
      .expect(200);
  });

  it('se puede quitar editando con vacío, y el ID liberado se puede reutilizar', async () => {
    const a = await nuevo({ nombre: 'Uno', erpId: 'ERP-Z' }).expect(201);
    const r = await gerente()
      .patch(`/products/${a.body.id}`)
      .send({ erpId: '' })
      .expect(200);
    expect(r.body.erpId).toBeNull();
    await nuevo({ nombre: 'Dos', erpId: 'ERP-Z' }).expect(201);
  });

  it('el mismo ID en otro negocio no choca', async () => {
    await nuevo({ nombre: 'Uno', erpId: 'ERP-COMUN' }).expect(201);
    const otro = await seedBase(s.h.prisma, {
      slug: 'otro-mayoreo',
      tipoStorefront: 'RETAIL_B2B',
    });
    const r = await apiRol(s.h, otro, 'GERENTE').post('/products').send({
      nombre: 'Otro',
      precio: 10,
      categoryId: otro.categoria.id,
      erpId: 'ERP-COMUN',
    });
    expect(r.status).toBe(201);
  });
});

describe('Negocio · mínimo de piezas en 0', () => {
  const s = usarSuite({
    seed: { tipoStorefront: 'RETAIL_B2B', b2b: { minimoPiezas: 100 } },
  });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');

  it('el Dueño puede dejarlo en 0 (y volver a 100); se refleja en Ajustes y en la info pública', async () => {
    await dueno()
      .patch('/tenant/me')
      .send({ pedidoB2bMinimoPiezas: 0 })
      .expect(200);
    expect(
      (await dueno().get('/tenant/me').expect(200)).body.pedidoB2bMinimoPiezas,
    ).toBe(0);
    const info = await request(s.h.app.getHttpServer())
      .get(`/public/pedidos-b2b/tenants/${s.base.tenant.slug}`)
      .expect(200);
    expect(info.body.pedidoB2bMinimoPiezas).toBe(0);
    await dueno()
      .patch('/tenant/me')
      .send({ pedidoB2bMinimoPiezas: 100 })
      .expect(200);
    expect(
      (await dueno().get('/tenant/me').expect(200)).body.pedidoB2bMinimoPiezas,
    ).toBe(100);
  });

  it('rechaza negativos y decimales (400); solo el Dueño (Gerente 403)', async () => {
    expect(
      (await dueno().patch('/tenant/me').send({ pedidoB2bMinimoPiezas: -1 }))
        .status,
    ).toBe(400);
    expect(
      (await dueno().patch('/tenant/me').send({ pedidoB2bMinimoPiezas: 2.5 }))
        .status,
    ).toBe(400);
    expect(
      (
        await apiRol(s.h, s.base, 'GERENTE')
          .patch('/tenant/me')
          .send({ pedidoB2bMinimoPiezas: 0 })
      ).status,
    ).toBe(403);
    expect(
      (await dueno().get('/tenant/me').expect(200)).body.pedidoB2bMinimoPiezas,
    ).toBe(100);
  });

  it('con mínimo 0 un pedido de pocas piezas se confirma; con 100 sigue exigiéndolo', async () => {
    const pocas = [
      {
        productId: s.base.productoB.id,
        distribucion: [{ dia: 'VIERNES', cantidad: 2 }],
      },
    ];
    // Con 100: el pedido se crea pero no se puede confirmar (el mínimo se valida al confirmar).
    const p100 = await crearAdminB2b(s.h, s.base, { items: pocas });
    expect(p100.minimoPiezasAplicado).toBe(100);
    expect(
      (await dueno().patch(`/pedidos-b2b/${p100.id}/avanzar`)).status,
    ).toBe(409);

    await dueno()
      .patch('/tenant/me')
      .send({ pedidoB2bMinimoPiezas: 0 })
      .expect(200);
    const p0 = await crearAdminB2b(s.h, s.base, { items: pocas });
    expect(p0.minimoPiezasAplicado).toBe(0);
    expect((await dueno().patch(`/pedidos-b2b/${p0.id}/avanzar`)).status).toBe(
      200,
    );
    // El pedido anterior conserva el mínimo con el que se creó (snapshot).
    expect(
      (await dueno().get(`/pedidos-b2b/${p100.id}`).expect(200)).body
        .minimoPiezasAplicado,
    ).toBe(100);
  });
});
