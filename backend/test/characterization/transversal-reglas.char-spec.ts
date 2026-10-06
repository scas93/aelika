import request from 'supertest';
import { configurarB2b, seedBase } from './db';
import { expectError, expectExacto } from './exacto';
import { bodyCheckout, cederEventLoop, postCheckout, usarSuite } from './helpers';
import { waitForCalls } from './harness';
import { normalizar } from './normalizar';
import { apiRol, crearAdminB2b, crearPublicoB2b } from './b2b-helpers';

// 0b-2 · Área 14 · Reglas de notificación.
// Excepción declarada a "solo HTTP": aquí ReglaEventoPedidoService es el REAL; solo ReglaEnvioService.enviar
// (frontera con Botpress) está sustituido (fakes.reglaEnvio). El filtro se ejerce por POST /reglas/:id/disparar,
// que llama a ReglasFiltroService.evaluar — el MISMO método que usa el barrido @Cron (reglas.service.ts:201 y
// regla-barrido.service.ts:116/145). El barrido en sí (cron) no se ejecuta en los tests.
describe('Transversal · Reglas de notificación', () => {
  const s = usarSuite({ reglasReales: true, seed: { tipoStorefront: 'RETAIL_B2B', b2b: {} } }); // Etapa 2: los pedidos B2B exigen un tenant RETAIL_B2B (mínimo 10, igual que antes)
  const dueno = () => apiRol(s.h, s.base, 'DUENO');

  const reglaBody = (extra: Record<string, unknown> = {}) => ({
    nombre: 'Aviso',
    trigger: 'EVENTO_PEDIDO',
    triggerConfig: { origen: 'ORDER', estatus: 'CONFIRMADO_SURTIENDO' },
    plantillaNombre: 'pedido_confirmado',
    plantillaIdioma: 'es_MX',
    plantillaCategoria: 'UTILITY',
    ...extra,
  });
  const reglaEsperada = (overrides: Record<string, unknown> = {}) => ({
    id: '<uuid>',
    tenantId: '<tenant>',
    nombre: 'Aviso',
    trigger: 'EVENTO_PEDIDO',
    triggerConfig: { origen: 'ORDER', estatus: 'CONFIRMADO_SURTIENDO' },
    filtro: [],
    canal: 'WHATSAPP',
    plantillaNombre: 'pedido_confirmado',
    plantillaIdioma: 'es_MX',
    plantillaCategoria: 'UTILITY',
    plantillaTexto: null,
    plantillaVariables: [],
    activa: true,
    disparadaEn: null,
    createdAt: '<iso>',
    updatedAt: '<iso>',
    ...overrides,
  });
  const et = () => ({ [s.base.tenant.id]: 'tenant' });
  const crear = async (extra: Record<string, unknown> = {}) => {
    const res = await dueno().post('/reglas', reglaBody(extra));
    if (res.status !== 201) throw new Error(`crear regla: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const evento = (origen: 'ORDER' | 'PEDIDO_B2B', estatus: string, extra: Record<string, unknown> = {}) =>
    crear({ nombre: `${origen}/${estatus}`, triggerConfig: { origen, estatus }, ...extra });

  describe('crear regla EVENTO_PEDIDO: qué estatus acepta y rechaza por origen', () => {
    it('ORDER acepta sus 4 estatus (respuesta exacta)', async () => {
      for (const estatus of ['PENDIENTE_CONFIRMACION', 'CONFIRMADO_SURTIENDO', 'LISTO_ENTREGA', 'DESPACHADO']) {
        const res = await dueno().post('/reglas', reglaBody({ triggerConfig: { origen: 'ORDER', estatus } }));
        expect(res.status).toBe(201);
        expectExacto(res.body, reglaEsperada({ triggerConfig: { origen: 'ORDER', estatus } }), et());
      }
    });

    it('PEDIDO_B2B acepta sus 3 estatus', async () => {
      for (const estatus of ['PENDIENTE_CONFIRMACION', 'CONFIRMADO_SURTIENDO', 'DESPACHADO']) {
        const res = await dueno().post('/reglas', reglaBody({ triggerConfig: { origen: 'PEDIDO_B2B', estatus } }));
        expect(res.status).toBe(201);
        expectExacto(res.body, reglaEsperada({ triggerConfig: { origen: 'PEDIDO_B2B', estatus } }), et());
      }
    });

    it('PEDIDO_B2B rechaza LISTO_ENTREGA (solo existe en ORDER) y ORDER rechaza un estatus inventado', async () => {
      expectError(
        await dueno().post('/reglas', reglaBody({ triggerConfig: { origen: 'PEDIDO_B2B', estatus: 'LISTO_ENTREGA' } })),
        400,
        'estatus "LISTO_ENTREGA" no es válido para origen PEDIDO_B2B (valores válidos: PENDIENTE_CONFIRMACION, CONFIRMADO_SURTIENDO, DESPACHADO).',
      );
      expectError(
        await dueno().post('/reglas', reglaBody({ triggerConfig: { origen: 'ORDER', estatus: 'NOPE' } })),
        400,
        'estatus "NOPE" no es válido para origen ORDER (valores válidos: PENDIENTE_CONFIRMACION, CONFIRMADO_SURTIENDO, LISTO_ENTREGA, DESPACHADO).',
      );
      expect(await s.h.prisma.regla.count()).toBe(0);
    });

    it('triggerConfig incompleto, con origen inválido o con claves extra: 400', async () => {
      expectError(await dueno().post('/reglas', reglaBody({ triggerConfig: {} })), 400, 'origen must be one of the following values: ORDER, PEDIDO_B2B');
      expectError(
        await dueno().post('/reglas', reglaBody({ triggerConfig: { origen: 'RESERVA', estatus: 'X' } })),
        400,
        'origen must be one of the following values: ORDER, PEDIDO_B2B',
      );
      expectError(
        await dueno().post('/reglas', reglaBody({ triggerConfig: { origen: 'ORDER', estatus: 'DESPACHADO', extra: 1 } })),
        400,
        'property extra should not exist',
      );
    });

    it('el filtro no aplica a EVENTO_PEDIDO: se guarda como lista vacía aunque se mande', async () => {
      const res = await dueno().post('/reglas', reglaBody({ filtro: [{ campo: 'TOTAL_PEDIDOS', operador: 'MAYOR_IGUAL', valor: 99 }] }));
      expect(res.status).toBe(201);
      expectExacto(res.body, reglaEsperada(), et());
    });

    it('PATCH revalida el estatus contra el origen resultante', async () => {
      const r = await evento('ORDER', 'LISTO_ENTREGA');
      expectError(
        await dueno().patch(`/reglas/${r.id}`).send({ triggerConfig: { origen: 'PEDIDO_B2B', estatus: 'LISTO_ENTREGA' } }),
        400,
        'estatus "LISTO_ENTREGA" no es válido para origen PEDIDO_B2B (valores válidos: PENDIENTE_CONFIRMACION, CONFIRMADO_SURTIENDO, DESPACHADO).',
      );
      const ok = await dueno().patch(`/reglas/${r.id}`).send({ triggerConfig: { origen: 'PEDIDO_B2B', estatus: 'DESPACHADO' }, nombre: 'Cambiada' });
      expect(ok.status).toBe(200);
      expectExacto(ok.body, reglaEsperada({ nombre: 'Cambiada', triggerConfig: { origen: 'PEDIDO_B2B', estatus: 'DESPACHADO' } }), et());
    });

    it('variables de plantilla: las de menudeo no aplican a PEDIDO_B2B; folio aplica a ambos; ninguna de pedido aplica a MANUAL', async () => {
      const menudeo = { plantillaVariables: [{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'tipoEntrega' }] };
      expect((await dueno().post('/reglas', reglaBody(menudeo))).status).toBe(201);
      expectError(
        await dueno().post('/reglas', reglaBody({ triggerConfig: { origen: 'PEDIDO_B2B', estatus: 'DESPACHADO' }, ...menudeo })),
        400,
        'La variable "Tipo de entrega" no aplica a esta Regla (Solo pedidos de menudeo).',
      );
      const folio = { plantillaVariables: [{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'folio' }] };
      expect((await dueno().post('/reglas', reglaBody({ triggerConfig: { origen: 'PEDIDO_B2B', estatus: 'DESPACHADO' }, ...folio }))).status).toBe(201);
      expectError(
        await dueno().post('/reglas', reglaBody({ trigger: 'MANUAL', triggerConfig: undefined, ...folio })),
        400,
        'La variable "Folio" no aplica a esta Regla (Solo en reglas de evento de pedido).',
      );
    });
  });

  describe('GET /reglas, permisos', () => {
    it('lista y detalle con la forma exacta; 404 si no existe', async () => {
      const r = await evento('ORDER', 'DESPACHADO');
      const lista = await dueno().get('/reglas').expect(200);
      expectExacto(lista.body, [reglaEsperada({ nombre: 'ORDER/DESPACHADO', triggerConfig: { origen: 'ORDER', estatus: 'DESPACHADO' } })], et());
      const uno = await dueno().get(`/reglas/${r.id}`).expect(200);
      expectExacto(uno.body, reglaEsperada({ nombre: 'ORDER/DESPACHADO', triggerConfig: { origen: 'ORDER', estatus: 'DESPACHADO' } }), et());
      expectError(await dueno().get('/reglas/00000000-0000-4000-8000-000000000000'), 404, 'Regla no encontrada');
    });

    it('solo el Dueño: Gerente y Operador 403, sin token 401', async () => {
      const msg = 'No tienes permiso para realizar esta acción';
      expectError(await apiRol(s.h, s.base, 'GERENTE').get('/reglas'), 403, msg);
      expectError(await apiRol(s.h, s.base, 'OPERADOR').post('/reglas', reglaBody()), 403, msg);
      expectError(await request(s.h.app.getHttpServer()).get('/reglas'), 401, 'Unauthorized');
    });
  });

  describe('coincidencia real de reglas de punta a punta (ReglaEventoPedidoService real)', () => {
    /** Argumentos con que ReglaEnvioService.enviar fue llamado, normalizados. */
    const llamada = (i: number, ids: Record<string, string>) => {
      const [tenant, cliente, regla, contexto] = s.h.fakes.reglaEnvio.mock.calls[i];
      return normalizar(
        {
          tenantId: tenant.id,
          cliente: { id: cliente.id, canal: cliente.canal, telefono: cliente.telefono },
          regla: { id: regla.id, nombre: regla.nombre },
          contexto,
        },
        { [s.base.tenant.id]: 'tenant', ...ids },
      );
    };

    it('cada regla se dispara solo con su origen + estatus, con el contexto correcto por tipo; PENDIENTE_CONFIRMACION nunca dispara; inactivas y de otro tenant no', async () => {
      const R1 = await evento('ORDER', 'CONFIRMADO_SURTIENDO');
      const R2 = await evento('ORDER', 'DESPACHADO');
      const R3 = await evento('PEDIDO_B2B', 'CONFIRMADO_SURTIENDO');
      const R4 = await evento('PEDIDO_B2B', 'DESPACHADO');
      await evento('ORDER', 'LISTO_ENTREGA', { activa: false }); // inactiva
      await evento('ORDER', 'PENDIENTE_CONFIRMACION'); // válida pero nunca dispara
      await evento('PEDIDO_B2B', 'PENDIENTE_CONFIRMACION'); // válida pero nunca dispara
      const otro = await seedBase(s.h.prisma, { slug: 'otro-negocio' });
      await apiRol(s.h, otro, 'DUENO').post('/reglas', reglaBody({ nombre: 'De otro tenant' })).expect(201);

      // Crear un pedido (de cualquier tipo) NO dispara ninguna regla.
      const o = (await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { items: [{ productId: s.base.productoA.id, cantidad: 2 }] }))).body;
      const p = await crearPublicoB2b(s.h, s.base);
      await waitForCalls(s.h.fakes.queueAdd);
      await cederEventLoop();
      expect(s.h.fakes.reglaEnvio).not.toHaveBeenCalled();

      const ids = { [R1.id]: 'R1', [R2.id]: 'R2', [R3.id]: 'R3', [R4.id]: 'R4', [o.clienteId]: 'clienteB2C', [p.clienteId]: 'clienteB2B' };
      const orden = () => dueno().patch(`/orders/${o.id}/avanzar`).expect(200);
      const pedido = () => dueno().patch(`/pedidos-b2b/${p.id}/avanzar`).expect(200);

      await orden(); // ORDER → CONFIRMADO_SURTIENDO
      await waitForCalls(s.h.fakes.reglaEnvio, 1);
      expect(llamada(0, ids)).toStrictEqual({
        tenantId: '<tenant>',
        cliente: { id: '<clienteB2C>', canal: 'B2C', telefono: '5511112222' },
        regla: { id: '<R1>', nombre: 'ORDER/CONFIRMADO_SURTIENDO' },
        contexto: {
          origen: 'ORDER',
          folio: '1',
          total: '90',
          estatus: 'CONFIRMADO_SURTIENDO',
          createdAt: '<iso>',
          items: [{ nombreProducto: 'Café americano', cantidad: 2 }],
          metodoEntrega: 'RECOGER',
          direccionCalle: null,
          direccionNumero: null,
          direccionColonia: null,
          metodoPago: 'EFECTIVO',
        },
      });

      await pedido(); // PEDIDO_B2B → CONFIRMADO_SURTIENDO
      await waitForCalls(s.h.fakes.reglaEnvio, 2);
      expect(llamada(1, ids)).toStrictEqual({
        tenantId: '<tenant>',
        cliente: { id: '<clienteB2B>', canal: 'B2B', telefono: '5533334444' },
        regla: { id: '<R3>', nombre: 'PEDIDO_B2B/CONFIRMADO_SURTIENDO' },
        contexto: {
          origen: 'PEDIDO_B2B',
          folio: '1',
          total: '662',
          estatus: 'CONFIRMADO_SURTIENDO',
          createdAt: '<iso>',
          items: [
            { nombreProducto: 'Café americano', cantidad: 12 },
            { nombreProducto: 'Concha', cantidad: 4 },
          ],
        },
      });

      await orden(); // LISTO_ENTREGA: su única regla está inactiva
      await cederEventLoop();
      expect(s.h.fakes.reglaEnvio).toHaveBeenCalledTimes(2);

      await orden(); // DESPACHADO
      await waitForCalls(s.h.fakes.reglaEnvio, 3);
      expect(llamada(2, ids).regla).toStrictEqual({ id: '<R2>', nombre: 'ORDER/DESPACHADO' });
      await pedido(); // DESPACHADO
      await waitForCalls(s.h.fakes.reglaEnvio, 4);
      expect(llamada(3, ids).regla).toStrictEqual({ id: '<R4>', nombre: 'PEDIDO_B2B/DESPACHADO' });

      await cederEventLoop();
      expect(s.h.fakes.reglaEnvio).toHaveBeenCalledTimes(4); // ninguna de PENDIENTE, inactiva ni de otro tenant
    });

    it('marcarPagado: en AL_FINAL no dispara; en AL_INICIO confirma y dispara la regla CONFIRMADO_SURTIENDO del origen PEDIDO_B2B', async () => {
      const R3 = await evento('PEDIDO_B2B', 'CONFIRMADO_SURTIENDO');
      const alFinal = await crearPublicoB2b(s.h, s.base);
      await dueno().patch(`/pedidos-b2b/${alFinal.id}/marcar-pagado`).expect(200);
      await cederEventLoop();
      expect(s.h.fakes.reglaEnvio).not.toHaveBeenCalled();

      await configurarB2b(s.h.prisma, s.base.tenant.id, { modoCobro: 'AL_INICIO' });
      const alInicio = await crearAdminB2b(s.h, s.base, { contactoTelefono: '5500000001' });
      await dueno().patch(`/pedidos-b2b/${alInicio.id}/marcar-pagado`).expect(200);
      await waitForCalls(s.h.fakes.reglaEnvio, 1);
      expect(llamada(0, { [R3.id]: 'R3' }).regla).toStrictEqual({ id: '<R3>', nombre: 'PEDIDO_B2B/CONFIRMADO_SURTIENDO' });
    });

    it('varias reglas del mismo origen y estatus se disparan todas; un PATCH a activa=false o a otro estatus cambia lo que dispara', async () => {
      const A = await evento('ORDER', 'CONFIRMADO_SURTIENDO');
      const B = await evento('ORDER', 'CONFIRMADO_SURTIENDO');
      const o = (await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base))).body;
      await waitForCalls(s.h.fakes.queueAdd);

      await dueno().patch(`/orders/${o.id}/avanzar`).expect(200);
      await waitForCalls(s.h.fakes.reglaEnvio, 2);
      expect(s.h.fakes.reglaEnvio.mock.calls.map((c) => c[2].id).sort()).toStrictEqual([A.id, B.id].sort());

      s.h.fakes.reglaEnvio.mockClear();
      await dueno().patch(`/reglas/${A.id}`).send({ activa: false }).expect(200);
      await dueno().patch(`/reglas/${B.id}`).send({ triggerConfig: { origen: 'ORDER', estatus: 'LISTO_ENTREGA' } }).expect(200);
      await dueno().patch(`/orders/${o.id}/avanzar`).expect(200); // LISTO_ENTREGA
      await waitForCalls(s.h.fakes.reglaEnvio, 1);
      expect(s.h.fakes.reglaEnvio.mock.calls.map((c) => c[2].id)).toStrictEqual([B.id]);
    });

    it('un fallo de la frontera (Botpress) no rompe el avance del pedido', async () => {
      await evento('ORDER', 'CONFIRMADO_SURTIENDO');
      const o = (await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base))).body;
      await waitForCalls(s.h.fakes.queueAdd);
      s.h.fakes.reglaEnvio.mockRejectedValueOnce(new Error('botpress caído'));
      const res = await dueno().patch(`/orders/${o.id}/avanzar`);
      expect(res.status).toBe(200);
      expect(res.body.estadoPedido).toBe('CONFIRMADO_SURTIENDO');
      await waitForCalls(s.h.fakes.reglaEnvio, 1);
    });
  });

  describe('filtro sobre Cliente (POST /reglas/:id/disparar, regla MANUAL)', () => {
    const manual = (filtro: unknown[] = [], extra: Record<string, unknown> = {}) =>
      crear({ nombre: 'Manual', trigger: 'MANUAL', triggerConfig: undefined, filtro, ...extra });
    const nombresEnviados = () => s.h.fakes.reglaEnvio.mock.calls.map((c) => `${c[1].canal}:${c[1].nombre}`).sort();

    /** B2C Ana (2 pedidos), B2C Bob (1, hace 3 días), B2B Luis (1), Lealtad-only Lia (0 pedidos), y un cliente de OTRO tenant. */
    beforeEach(async () => {
      await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteNombre: 'Ana', clienteTelefono: '5511110001' }));
      await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteNombre: 'Ana', clienteTelefono: '5511110001' }));
      jest.setSystemTime(new Date('2026-09-27T16:00:00.000Z'));
      await postCheckout(s.h, s.base.tenant.slug, bodyCheckout(s.base, { clienteNombre: 'Bob', clienteTelefono: '5511110002' }));
      jest.setSystemTime(new Date('2026-09-30T16:00:00.000Z'));
      await crearPublicoB2b(s.h, s.base, { contactoNombre: 'Luis', contactoTelefono: '5511110003' });
      await apiRol(s.h, s.base, 'DUENO').post('/lealtad/clientes', { nombre: 'Lia', telefono: '5511110004' }).expect(201);
      const otro = await seedBase(s.h.prisma, { slug: 'otro-negocio' });
      await postCheckout(s.h, otro.tenant.slug, bodyCheckout(otro, { clienteNombre: 'Ajeno', clienteTelefono: '5599990000' }));
      await waitForCalls(s.h.fakes.queueAdd, 4);
      s.h.fakes.reset();
      jest.setSystemTime(new Date('2026-09-30T20:00:00.000Z'));
    });

    it('sin filtro ([]): alcanza a TODOS los clientes del tenant, de ambos canales y también al de Lealtad, no a los de otro tenant', async () => {
      const r = await manual([]);
      const res = await dueno().post(`/reglas/${r.id}/disparar`);
      expect(res.status).toBe(201);
      expect(res.body).toStrictEqual({ clientesMatcheados: 4, enviosDisparados: 4, bloqueadosPorCandado: 0, conError: 0 });
      expect(nombresEnviados()).toStrictEqual(['B2B:Luis', 'B2C:Ana', 'B2C:Bob', 'B2C:Lia']);
      // sin contexto de pedido: enviar(tenant, cliente, regla)
      expect(s.h.fakes.reglaEnvio.mock.calls.every((c) => c.length === 3)).toBe(true);
    });

    it('el filtro NO distingue canal: TOTAL_PEDIDOS >= 1 alcanza clientes B2C y B2B por igual', async () => {
      const r = await manual([{ campo: 'TOTAL_PEDIDOS', operador: 'MAYOR_IGUAL', valor: 1 }]);
      const res = await dueno().post(`/reglas/${r.id}/disparar`);
      expect(res.body).toStrictEqual({ clientesMatcheados: 3, enviosDisparados: 3, bloqueadosPorCandado: 0, conError: 0 });
      expect(nombresEnviados()).toStrictEqual(['B2B:Luis', 'B2C:Ana', 'B2C:Bob']);
    });

    it('otras condiciones: TOTAL_PEDIDOS >= 2, = 0, y antigüedad del último pedido (>= 2 días / <= 1 día); condiciones combinadas con Y', async () => {
      const disparar = async (filtro: unknown[]) => {
        s.h.fakes.reglaEnvio.mockClear();
        const r = await manual(filtro);
        const res = await dueno().post(`/reglas/${r.id}/disparar`).expect(201);
        return { resumen: res.body.clientesMatcheados, quienes: nombresEnviados() };
      };
      expect(await disparar([{ campo: 'TOTAL_PEDIDOS', operador: 'MAYOR_IGUAL', valor: 2 }])).toStrictEqual({ resumen: 1, quienes: ['B2C:Ana'] });
      expect(await disparar([{ campo: 'TOTAL_PEDIDOS', operador: 'IGUAL', valor: 0 }])).toStrictEqual({ resumen: 1, quienes: ['B2C:Lia'] });
      expect(await disparar([{ campo: 'ULTIMO_PEDIDO_ANTIGUEDAD_DIAS', operador: 'MAYOR_IGUAL', valor: 2 }])).toStrictEqual({ resumen: 1, quienes: ['B2C:Bob'] });
      expect(await disparar([{ campo: 'ULTIMO_PEDIDO_ANTIGUEDAD_DIAS', operador: 'MENOR_IGUAL', valor: 1 }])).toStrictEqual({
        resumen: 3,
        quienes: ['B2B:Luis', 'B2C:Ana', 'B2C:Lia'],
      });
      expect(
        await disparar([
          { campo: 'TOTAL_PEDIDOS', operador: 'MAYOR_IGUAL', valor: 1 },
          { campo: 'ULTIMO_PEDIDO_ANTIGUEDAD_DIAS', operador: 'MENOR_IGUAL', valor: 1 },
        ]),
      ).toStrictEqual({ resumen: 2, quienes: ['B2B:Luis', 'B2C:Ana'] });
    });

    it('un fallo de envío se cuenta en conError y no detiene a los demás', async () => {
      s.h.fakes.reglaEnvio.mockRejectedValueOnce(new Error('botpress caído'));
      const r = await manual([]);
      const res = await dueno().post(`/reglas/${r.id}/disparar`);
      expect(res.body).toStrictEqual({ clientesMatcheados: 4, enviosDisparados: 3, bloqueadosPorCandado: 0, conError: 1 });
    });

    it('rechazos: no MANUAL (400), inactiva (400), inexistente o de otro tenant (404), no Dueño (403)', async () => {
      const evt = await evento('ORDER', 'DESPACHADO');
      expectError(await dueno().post(`/reglas/${evt.id}/disparar`), 400, 'Solo se puede disparar a demanda una Regla de tipo MANUAL.');
      const inactiva = await manual([], { activa: false });
      expectError(await dueno().post(`/reglas/${inactiva.id}/disparar`), 400, 'Esta Regla está inactiva.');
      expectError(await dueno().post('/reglas/00000000-0000-4000-8000-000000000000/disparar'), 404, 'Regla no encontrada');
      const otro = await seedBase(s.h.prisma, { slug: 'otro-tenant-2' });
      expectError(await apiRol(s.h, otro, 'DUENO').post(`/reglas/${inactiva.id}/disparar`), 404, 'Regla no encontrada');
      const r = await manual([]);
      expectError(await apiRol(s.h, s.base, 'GERENTE').post(`/reglas/${r.id}/disparar`), 403, 'No tienes permiso para realizar esta acción');
      expect(s.h.fakes.reglaEnvio).not.toHaveBeenCalled();
    });

    it('validación del filtro al crear: IGUAL no aplica a los campos de antigüedad; campo u operador inválidos', async () => {
      expectError(
        await dueno().post('/reglas', reglaBody({ trigger: 'MANUAL', triggerConfig: undefined, filtro: [{ campo: 'ULTIMO_PEDIDO_ANTIGUEDAD_DIAS', operador: 'IGUAL', valor: 3 }] })),
        400,
        'El operador IGUAL no aplica al campo ULTIMO_PEDIDO_ANTIGUEDAD_DIAS — usa MAYOR_IGUAL o MENOR_IGUAL.',
      );
      expectError(
        await dueno().post('/reglas', reglaBody({ trigger: 'MANUAL', triggerConfig: undefined, filtro: [{ campo: 'CANAL', operador: 'IGUAL', valor: 1 }] })),
        400,
        'campo must be one of the following values: TOTAL_PEDIDOS, ULTIMO_PEDIDO_ANTIGUEDAD_DIAS, PRIMER_PEDIDO_ANTIGUEDAD_DIAS',
      );
    });
  });

  it('las reglas de otro tenant no aparecen en /reglas', async () => {
    await crear({ nombre: 'Mía' });
    const otro = await seedBase(s.h.prisma, { slug: 'otro-negocio' });
    await apiRol(s.h, otro, 'DUENO').post('/reglas', reglaBody({ nombre: 'Ajena' })).expect(201);
    const lista = await dueno().get('/reglas').expect(200);
    expect(lista.body.map((r: any) => r.nombre)).toStrictEqual(['Mía']);
  });
});
