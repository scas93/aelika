import { crearClienteB2b, construirCodigoCliente, telefonoDestino, sembrarClienteB2b } from '../../src/clientes/cliente-b2b';
import { usarSuite } from './helpers';

// Entrega 2a: base de los clientes B2B (esquema + helpers). La API y los pedidos llegan en 2c/2d.
describe('Clientes B2B · base (2a)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const alta = (sufijo: string, telefonos: { telefono: string; principal?: boolean }[], extra = {}) =>
    crearClienteB2b(s.h.prisma, {
      tenantId: s.base.tenant.id,
      tenantSlug: s.base.tenant.slug,
      sufijo,
      nombre: `Cliente ${sufijo}`,
      direccion: 'Calle 1',
      telefonos,
      ...extra,
    });

  it('alta: código {slug}-{sufijo}, sin Cliente.telefono, contadores en 0 y principal por defecto', async () => {
    const c = await alta('Américas Sur', [{ telefono: '+52 55 1111 2222' }, { telefono: '5533334444' }], { descuentoPorcentaje: 10 });
    expect(c.codigo).toBe('cafe-test-americas-sur');
    expect(c.canal).toBe('B2B');
    expect(c.telefono).toBeNull();
    expect(c.totalPedidos).toBe(0);
    expect(Number(c.descuentoPorcentaje)).toBe(10);
    const tels = await s.h.prisma.clienteTelefono.findMany({ where: { clienteId: c.id }, orderBy: { telefono: 'asc' } });
    expect(tels.map((t) => [t.telefono, t.principal])).toEqual([['5511112222', true], ['5533334444', false]]);
    expect(await telefonoDestino(s.h.prisma, c)).toBe('5511112222');
  });

  it('un mismo teléfono puede estar en varios clientes del mismo negocio', async () => {
    const a = await alta('matriz', [{ telefono: '5511112222' }]);
    const b = await alta('norte', [{ telefono: '5511112222' }]);
    expect(await s.h.prisma.clienteTelefono.count({ where: { telefono: '5511112222' } })).toBe(2);
    expect(a.id).not.toBe(b.id);
  });

  it('rechaza: código repetido (409), sin teléfonos, repetidos, dos principales y descuento fuera de rango', async () => {
    await alta('matriz', [{ telefono: '5511112222' }]);
    await expect(alta('Matriz', [{ telefono: '5599990000' }])).rejects.toMatchObject({ status: 409 });
    await expect(alta('x', [])).rejects.toMatchObject({ status: 400 });
    await expect(alta('x', [{ telefono: '5511112222' }, { telefono: '55 1111 2222' }])).rejects.toMatchObject({ status: 400 });
    await expect(alta('x', [{ telefono: '5511112222', principal: true }, { telefono: '5533334444', principal: true }])).rejects.toMatchObject({ status: 400 });
    await expect(alta('x', [{ telefono: '5511112222' }], { descuentoPorcentaje: 120 })).rejects.toMatchObject({ status: 400 });
    expect(() => construirCodigoCliente('cafe-test', '  ¡¡ ')).toThrow();
  });

  it('la base impide dos principales en un cliente y un B2C sin teléfono', async () => {
    const c = await alta('matriz', [{ telefono: '5511112222' }]);
    await expect(
      s.h.prisma.clienteTelefono.create({ data: { tenantId: c.tenantId, clienteId: c.id, telefono: '5533334444', principal: true } }),
    ).rejects.toBeDefined();
    await expect(
      s.h.prisma.cliente.create({
        data: { tenantId: c.tenantId, canal: 'B2C', telefono: null, nombre: 'X', primerPedidoAt: new Date(), ultimoPedidoAt: new Date() },
      }),
    ).rejects.toBeDefined();
  });

  it('telefonoDestino: B2C usa su teléfono', async () => {
    const c = await s.h.prisma.cliente.create({
      data: { tenantId: s.base.tenant.id, canal: 'B2C', telefono: '5544445555', nombre: 'Ana', primerPedidoAt: new Date(), ultimoPedidoAt: new Date() },
    });
    expect(await telefonoDestino(s.h.prisma, c)).toBe('5544445555');
  });

  it('sembrar es idempotente: actualiza datos y reemplaza teléfonos sin duplicar', async () => {
    const base = { tenantId: s.base.tenant.id, tenantSlug: s.base.tenant.slug, sufijo: 'matriz', nombre: 'A', direccion: 'D' };
    const c1 = await sembrarClienteB2b(s.h.prisma, { ...base, telefonos: [{ telefono: '5511112222' }] });
    const c2 = await sembrarClienteB2b(s.h.prisma, { ...base, nombre: 'B', telefonos: [{ telefono: '5533334444' }] });
    expect(c2.id).toBe(c1.id);
    expect(c2.nombre).toBe('B');
    expect(await s.h.prisma.cliente.count({ where: { canal: 'B2B' } })).toBe(1);
    expect((await s.h.prisma.clienteTelefono.findMany({ where: { clienteId: c1.id } })).map((t) => t.telefono)).toEqual(['5533334444']);
  });

  it('Product.erpId: opcional, varios NULL conviven, repetido en el mismo negocio no', async () => {
    const mk = (nombre: string, erpId: string | null) =>
      s.h.prisma.product.create({ data: { tenantId: s.base.tenant.id, categoryId: s.base.categoria.id, nombre, precio: '10.00', erpId } });
    await mk('P1', null);
    await mk('P2', null);
    await mk('P3', 'ERP-1');
    await expect(mk('P4', 'ERP-1')).rejects.toBeDefined();
  });
});
