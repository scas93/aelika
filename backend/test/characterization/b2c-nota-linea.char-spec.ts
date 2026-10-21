import { conectarStripe, seedModificadores } from './db';
import { expectError } from './exacto';
import { bodyCheckout, cederEventLoop, postCheckout, usarSuite } from './helpers';
import { waitForCalls } from './harness';

// Nota por producto (solo B2C): captura en el checkout, persistencia por línea, huella de tarjeta y recibo de Telegram.
describe('B2C · nota por producto', () => {
  const s = usarSuite();

  const lineas = () => s.h.prisma.orderItem.findMany({ orderBy: { nombreProducto: 'asc' } });
  const recibo = () => {
    const job = s.h.fakes.queueAdd.mock.calls.map(([, d]) => d).find((d) => d.evento === 'PEDIDO_RECIBIDO');
    return job!.mensaje.texto as string;
  };
  const conNota = (nota: unknown, extra: Record<string, unknown> = {}) =>
    bodyCheckout(s.base, { items: [{ productId: s.base.productoA.id, cantidad: 1, nota }], ...extra });

  describe('persistencia y respuesta', () => {
    it('línea con nota: se guarda en OrderItem y sale en el ítem de la respuesta', async () => {
      const res = await postCheckout(s.h, s.base.tenant.slug, conNota('Extra caliente'));
      expect(res.status).toBe(201);
      expect(res.body.items[0].nota).toBe('Extra caliente');
      expect((await lineas())[0].nota).toBe('Extra caliente');
    });

    it('sin nota: el ítem trae nota null', async () => {
      const res = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
      expect(res.body.items[0].nota).toBeNull();
      expect((await lineas())[0].nota).toBeNull();
    });

    it.each([['vacía', ''], ['solo espacios', '   '], ['solo saltos de línea y tabuladores', '\n\t \n']])(
      'nota %s = sin nota',
      async (_n, nota) => {
        const res = await postCheckout(s.h, s.base.tenant.slug, conNota(nota));
        expect(res.status).toBe(201);
        expect(res.body.items[0].nota).toBeNull();
        expect((await lineas())[0].nota).toBeNull();
      },
    );

    it('normaliza: recorta, colapsa espacios repetidos y cambia saltos de línea y tabuladores por un espacio', async () => {
      const res = await postCheckout(s.h, s.base.tenant.slug, conNota('  Sin    hielo\n\npor\tfavor  \r\n gracias '));
      expect(res.body.items[0].nota).toBe('Sin hielo por favor gracias');
      expect((await lineas())[0].nota).toBe('Sin hielo por favor gracias');
    });

    it('mismo producto con notas distintas: una fila por línea, cada una con su nota', async () => {
      const res = await postCheckout(
        s.h,
        s.base.tenant.slug,
        bodyCheckout(s.base, {
          items: [
            { productId: s.base.productoA.id, cantidad: 1, nota: 'Extra caliente' },
            { productId: s.base.productoA.id, cantidad: 2, nota: 'Sin hielo' },
            { productId: s.base.productoA.id, cantidad: 1 },
          ],
        }),
      );
      expect(res.status).toBe(201);
      const filas = await s.h.prisma.orderItem.findMany();
      expect(filas).toHaveLength(3);
      expect(filas.map((f) => [f.cantidad, f.nota]).sort()).toStrictEqual(
        [[1, 'Extra caliente'], [1, null], [2, 'Sin hielo']].sort(),
      );
    });

    it('la nota no altera el cálculo del total', async () => {
      const a = await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
      const b = await postCheckout(s.h, s.base.tenant.slug, conNota('Extra caliente'));
      expect(b.body.total).toBe(a.body.total);
    });
  });

  describe('tope de 140 caracteres', () => {
    it('140 caracteres: aceptada', async () => {
      const res = await postCheckout(s.h, s.base.tenant.slug, conNota('a'.repeat(140)));
      expect(res.status).toBe(201);
      expect(res.body.items[0].nota).toHaveLength(140);
    });

    it('141 caracteres: 400 y el pedido no deja rastro', async () => {
      const res = await postCheckout(s.h, s.base.tenant.slug, conNota('a'.repeat(141)));
      expectError(res, 400, ['items.0.La nota del producto admite máximo 140 caracteres']);
      await cederEventLoop();
      expect(await s.h.prisma.order.count()).toBe(0);
      expect(await s.h.prisma.orderItem.count()).toBe(0);
      expect(await s.h.prisma.cliente.count()).toBe(0);
    });

    it('el tope se cuenta DESPUÉS de normalizar: 200 caracteres crudos que normalizan a 100 se aceptan', async () => {
      const res = await postCheckout(s.h, s.base.tenant.slug, conNota(`${'a'.repeat(50)}${' '.repeat(100)}${'b'.repeat(50)}`));
      expect(res.status).toBe(201);
      expect(res.body.items[0].nota).toBe(`${'a'.repeat(50)} ${'b'.repeat(50)}`);
    });

    it('un emoji cuenta como 1 carácter (igual que en la tienda): 140 emojis sí, 141 no', async () => {
      expect((await postCheckout(s.h, s.base.tenant.slug, conNota('😀'.repeat(140)))).status).toBe(201);
      expect((await postCheckout(s.h, s.base.tenant.slug, conNota('😀'.repeat(141)))).status).toBe(400);
    });

    it('una nota que no es texto: 400', async () => {
      expect((await postCheckout(s.h, s.base.tenant.slug, conNota(123))).status).toBe(400);
    });
  });

  describe('recibo de Telegram', () => {
    it('la nota va debajo de su línea, después de los modificadores, y el resto del recibo no cambia', async () => {
      const { opciones } = await seedModificadores(s.h.prisma, s.base.tenant.id, s.base.productoA.id, {
        opciones: [{ nombre: 'Grande', precioAdicional: '30' }],
      });
      await postCheckout(
        s.h,
        s.base.tenant.slug,
        bodyCheckout(s.base, {
          items: [
            { productId: s.base.productoA.id, cantidad: 1, modifierOptionIds: [opciones[0].id], nota: 'Extra caliente' },
            { productId: s.base.productoB.id, cantidad: 1 },
          ],
        }),
      );
      await waitForCalls(s.h.fakes.queueAdd);
      const texto = recibo();
      const lineasTexto = texto.split('\n');
      const i = lineasTexto.findIndex((l) => l.includes('Tamaño: Grande'));
      expect(lineasTexto[i + 1]).toBe('   ↳ Extra caliente');
      // La línea sin nota no agrega nada.
      expect(texto.match(/↳/g)).toHaveLength(1);
      expect(texto).toMatchSnapshot();
    });

    it('sin nota por línea, el recibo es idéntico al de siempre (sin marcas)', async () => {
      await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base));
      await waitForCalls(s.h.fakes.queueAdd);
      expect(recibo()).not.toContain('↳');
    });

    it('caracteres especiales: la nota sale literal (texto plano, sin parse_mode)', async () => {
      const nota = 'Sin <b>cebolla</b> & *extra* _salsa_ `x` [a](b) "ok" 🙏 #1';
      await postCheckout(s.h, s.base.tenant.slug, conNota(nota));
      await waitForCalls(s.h.fakes.queueAdd);
      expect(recibo()).toContain(`\n   ↳ ${nota}\n`);
    });

    it('nota con saltos de línea: llega normalizada a una sola línea (no rompe la estructura del recibo)', async () => {
      await postCheckout(s.h, s.base.tenant.slug, conNota('Sin hielo\nTOTAL: $0.00\n------'));
      await waitForCalls(s.h.fakes.queueAdd);
      const texto = recibo();
      expect(texto).toContain('\n   ↳ Sin hielo TOTAL: $0.00 ------\n');
      expect(texto.match(/^TOTAL:/gm)).toHaveLength(1);
    });

    it('un pedido de muchas líneas con nota se encola completo (el corte en varios mensajes lo hace el proveedor)', async () => {
      const items = Array.from({ length: 80 }, (_, i) => ({
        productId: s.base.productoA.id,
        cantidad: 1,
        nota: `Instrucción número ${i} ${'x'.repeat(100)}`,
      }));
      await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { items }));
      await waitForCalls(s.h.fakes.queueAdd);
      const texto = recibo();
      expect(texto.length).toBeGreaterThan(4096);
      for (let i = 0; i < 80; i++) expect(texto).toContain(`↳ Instrucción número ${i} `);
      expect(texto.trimEnd().split('\n').some((l) => l.startsWith('TOTAL:'))).toBe(true);
    });
  });

  describe('huella de tarjeta', () => {
    beforeEach(async () => {
      await conectarStripe(s.h.prisma, s.base.tenant.id);
    });
    const tarjeta = (nota?: unknown) =>
      postCheckout(
        s.h,
        s.base.tenant.slug,
        bodyCheckout(s.base, { metodoPago: 'TARJETA', items: [{ productId: s.base.productoA.id, cantidad: 1, ...(nota !== undefined ? { nota } : {}) }] }),
      );

    it('la misma nota (aunque venga con otros espacios) reutiliza el pedido pendiente', async () => {
      const a = await tarjeta('Extra caliente');
      const b = await tarjeta('  Extra   caliente ');
      expect(b.body.id).toBe(a.body.id);
      expect(await s.h.prisma.order.count()).toBe(1);
    });

    it('otra nota: pedido y PaymentIntent nuevos, y se cancela el cobro del anterior', async () => {
      const a = await tarjeta('Extra caliente');
      const b = await tarjeta('Sin hielo');
      expect(b.body.id).not.toBe(a.body.id);
      expect(await s.h.prisma.order.count()).toBe(2);
      expect(s.h.fakes.paymentIntentsCancel).toHaveBeenCalledWith(a.body.stripePaymentIntentId);
    });

    it('con nota vs sin nota: son carritos distintos', async () => {
      const a = await tarjeta();
      const b = await tarjeta('Sin hielo');
      expect(b.body.id).not.toBe(a.body.id);
    });

    it('nota vacía o solo espacios = sin nota: reutiliza el pedido sin nota', async () => {
      const a = await tarjeta();
      const b = await tarjeta('   ');
      expect(b.body.id).toBe(a.body.id);
    });
  });
});
