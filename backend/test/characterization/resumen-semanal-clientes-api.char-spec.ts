import { auth, usarSuite } from './helpers';
import { apiRol, crearAdminB2b, SEMANA_ACTUAL, SEMANA_PASADA } from './b2b-helpers';
import { expectError } from './exacto';

// API del resumen semanal por cliente: ficha del cliente (Gerente y Dueño), correo de respuestas y botones de prueba (solo Dueño).
// Reloj: miércoles 2026-09-30 → semana anterior 2026-09-21 (SEMANA_PASADA).
const MSG_403 = 'No tienes permiso para realizar esta acción';
const BASE = '/notificaciones/resumen-semanal';

describe('Resumen semanal por cliente · API (mayoreo)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  const gerente = () => apiRol(s.h, s.base, 'GERENTE');
  const enviar = () => s.h.fakes.correoEnviarConAdjuntos;
  const marcas = () => s.h.prisma.resumenSemanalClienteEnvio.count();
  const cliente = async (nombre: string, semana = SEMANA_PASADA) => {
    const p = await crearAdminB2b(s.h, s.base, { negocioNombre: nombre, semanaInicio: semana });
    return (await s.h.prisma.order.findUniqueOrThrow({ where: { id: p.id } })).clienteId!;
  };
  const ficha = async (id: string) => (await dueno().get(`/clientes-b2b/${id}`).expect(200)).body;

  describe('ficha del cliente B2B', () => {
    it('nace apagado y sin correo; el correo heredado (Cliente.correo) no se prellena', async () => {
      const id = await cliente('Uno');
      await s.h.prisma.cliente.update({ where: { id }, data: { correo: 'heredado@x.test' } });
      expect(await ficha(id)).toMatchObject({ resumenSemanalActivo: false, resumenSemanalCorreo: null });
    });

    it('Gerente y Dueño lo editan; el correo se normaliza y encender exige correo', async () => {
      const id = await cliente('Uno');
      const msg = 'Captura el correo del resumen para poder encender el envío';
      expectError(await gerente().patch(`/clientes-b2b/${id}`).send({ resumenSemanalActivo: true }), 400, msg);
      const r = await gerente()
        .patch(`/clientes-b2b/${id}`)
        .send({ resumenSemanalActivo: true, resumenSemanalCorreo: ' Compras@Uno.TEST ' })
        .expect(200);
      expect(r.body).toMatchObject({ resumenSemanalActivo: true, resumenSemanalCorreo: 'compras@uno.test' });
      const bd = await s.h.prisma.cliente.findUniqueOrThrow({ where: { id } });
      expect(bd.resumenSemanalActivadoAt).not.toBeNull();
      expect(bd.correo).toBe('compras@laesquina.test'); // el de la fixture: la ficha nunca lo toca ni lo copia
      const lista = (await dueno().get('/clientes-b2b').expect(200)).body.data;
      expect(lista[0]).toMatchObject({ resumenSemanalActivo: true, resumenSemanalCorreo: 'compras@uno.test' });
    });

    it('correo inválido 400; borrar el correo con el envío encendido lo apaga; Operador 403', async () => {
      const id = await cliente('Uno');
      const r = await dueno().patch(`/clientes-b2b/${id}`).send({ resumenSemanalCorreo: 'no-es-correo' });
      expect(r.status).toBe(400);
      await dueno().patch(`/clientes-b2b/${id}`).send({ resumenSemanalActivo: true, resumenSemanalCorreo: 'a@b.co' }).expect(200);
      const apagado = (await dueno().patch(`/clientes-b2b/${id}`).send({ resumenSemanalCorreo: null }).expect(200)).body;
      expect(apagado).toMatchObject({ resumenSemanalActivo: false, resumenSemanalCorreo: null });
      expectError(await apiRol(s.h, s.base, 'OPERADOR').patch(`/clientes-b2b/${id}`).send({ resumenSemanalCorreo: 'a@b.co' }), 403, MSG_403);
    });

    it('en el alta: con correo e interruptor queda configurado; sin correo, apagado', async () => {
      const body = (extra: Record<string, unknown>) => ({
        nombre: 'Nuevo Cliente',
        direccion: 'Calle 1 #2',
        modalidadPago: 'AL_FINAL',
        telefonos: [{ telefono: '5511223344', principal: true }],
        ...extra,
      });
      const sin = (await gerente().post('/clientes-b2b').send(body({})).expect(201)).body;
      expect(sin).toMatchObject({ resumenSemanalActivo: false, resumenSemanalCorreo: null });
      const con = (
        await dueno()
          .post('/clientes-b2b')
          .send({ ...body({ resumenSemanalActivo: true, resumenSemanalCorreo: 'x@y.co' }), telefonos: [{ telefono: '5599887766', principal: true }] })
          .expect(201)
      ).body;
      expect(con).toMatchObject({ resumenSemanalActivo: true, resumenSemanalCorreo: 'x@y.co' });
      expectError(
        await dueno().post('/clientes-b2b').send({ ...body({ resumenSemanalActivo: true }), telefonos: [{ telefono: '5500001111', principal: true }] }),
        400,
        'Captura el correo del resumen para poder encender el envío',
      );
    });
  });

  describe('correo de respuestas del negocio', () => {
    it('GET/PUT solo Dueño; se normaliza, vacío lo borra y uno inválido da 400', async () => {
      expect((await dueno().get(`${BASE}/clientes/config`).expect(200)).body).toEqual({ correoRespuestas: null });
      expect((await dueno().put(`${BASE}/clientes/config`).send({ correoRespuestas: ' Ventas@Negocio.TEST ' }).expect(200)).body).toEqual({
        correoRespuestas: 'ventas@negocio.test',
      });
      expect((await s.h.prisma.tenant.findUniqueOrThrow({ where: { id: s.base.tenant.id } })).correoRespuestas).toBe('ventas@negocio.test');
      expect((await dueno().put(`${BASE}/clientes/config`).send({ correoRespuestas: 'mal' })).status).toBe(400);
      expect((await dueno().put(`${BASE}/clientes/config`).send({ correoRespuestas: '' }).expect(200)).body).toEqual({ correoRespuestas: null });
      for (const rol of ['GERENTE', 'OPERADOR'] as const) {
        expectError(await apiRol(s.h, s.base, rol).put(`${BASE}/clientes/config`).send({ correoRespuestas: null }), 403, MSG_403);
        expectError(await apiRol(s.h, s.base, rol).get(`${BASE}/clientes/config`), 403, MSG_403);
      }
    });
  });

  describe('botón de prueba del cliente', () => {
    it('manda a la dirección del Dueño (no al cliente), con Reply-To, la semana elegida, sin marca ni tocar el envío del lunes', async () => {
      await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { correoRespuestas: 'ventas@negocio.test' } });
      const id = await cliente('Uno', SEMANA_ACTUAL);
      await s.h.prisma.cliente.update({ where: { id }, data: { resumenSemanalCorreo: 'cliente@x.test', resumenSemanalActivo: true } });
      const r = await dueno().post(`${BASE}/clientes/prueba`).send({ clienteId: id, correo: ' Yo@Mio.TEST ', semanaInicio: SEMANA_ACTUAL }).expect(200);
      expect(r.body).toEqual({ resultado: 'EXITO', motivo: null, semanaInicio: SEMANA_ACTUAL, semanaFin: '2026-10-04' });
      expect(enviar()).toHaveBeenCalledTimes(1);
      const arg = enviar().mock.calls[0][0];
      expect(arg.destinatarios).toEqual(['yo@mio.test']);
      expect(arg.replyTo).toBe('ventas@negocio.test');
      expect(arg.adjuntos).toHaveLength(1);
      expect(await marcas()).toBe(0);
    });

    it('semana por defecto = anterior; sin pedidos esa semana 409; semana no lunes/ilegible 400; correo inválido 400; cliente ajeno 404; fallo 200 FALLO', async () => {
      const id = await cliente('Uno'); // semana anterior (2026-09-21)
      const ok = await dueno().post(`${BASE}/clientes/prueba`).send({ clienteId: id, correo: 'yo@x.test' }).expect(200);
      expect(ok.body).toMatchObject({ resultado: 'EXITO', semanaInicio: SEMANA_PASADA });
      expectError(
        await dueno().post(`${BASE}/clientes/prueba`).send({ clienteId: id, correo: 'yo@x.test', semanaInicio: '2026-09-14' }),
        409,
        'Este cliente no tuvo pedidos en esa semana: no hay nada que enviar',
      );
      expect((await dueno().post(`${BASE}/clientes/prueba`).send({ clienteId: id, correo: 'yo@x.test', semanaInicio: '2026-09-22' })).status).toBe(400);
      expect((await dueno().post(`${BASE}/clientes/prueba`).send({ clienteId: id, correo: 'yo@x.test', semanaInicio: '2026-02-30' })).status).toBe(400);
      expect((await dueno().post(`${BASE}/clientes/prueba`).send({ clienteId: id, correo: 'mal' })).status).toBe(400);
      expectError(
        await dueno().post(`${BASE}/clientes/prueba`).send({ clienteId: '00000000-0000-4000-8000-000000000000', correo: 'yo@x.test' }),
        404,
        'Cliente no encontrado',
      );
      enviar().mockResolvedValueOnce({ exito: false, error: 'Resend: dominio no verificado' });
      const fallo = await dueno().post(`${BASE}/clientes/prueba`).send({ clienteId: id, correo: 'yo@x.test' }).expect(200);
      expect(fallo.body).toMatchObject({ resultado: 'FALLO', motivo: 'Resend: dominio no verificado' });
    });

    it('solo Dueño: Gerente y Operador 403, sin sesión 401', async () => {
      const id = await cliente('Uno');
      for (const rol of ['GERENTE', 'OPERADOR'] as const)
        expectError(await apiRol(s.h, s.base, rol).post(`${BASE}/clientes/prueba`).send({ clienteId: id, correo: 'a@b.co' }), 403, MSG_403);
      expect((await auth(s.h, 'x').post(`${BASE}/clientes/prueba`).send({})).status).toBe(401);
      expect(enviar()).not.toHaveBeenCalled();
    });
  });

  describe('botón de prueba del resumen al negocio: elegir la semana', () => {
    it('semana elegida; sin semana, la anterior; inválida 400', async () => {
      await s.h.prisma.notificacionCanalConfig.create({
        data: { tenantId: s.base.tenant.id, tipo: 'CORREO', config: { nombreRemitente: 'Banetto', correos: ['ana@x.test'] }, activo: false },
      });
      await cliente('Uno', SEMANA_ACTUAL);
      const a = await dueno().post(`${BASE}/prueba`).send({ semanaInicio: SEMANA_ACTUAL }).expect(200);
      expect(a.body).toMatchObject({ resultado: 'EXITO', conPedidos: true, semanaInicio: SEMANA_ACTUAL });
      const b = await dueno().post(`${BASE}/prueba`).expect(200);
      expect(b.body).toMatchObject({ semanaInicio: SEMANA_PASADA, conPedidos: false });
      expect((await dueno().post(`${BASE}/prueba`).send({ semanaInicio: '2026-09-29' })).status).toBe(400);
    });
  });
});

describe.each([['RETAIL_B2C'], ['HOTEL']] as const)('Resumen por cliente NO aplica a %s', (tipoStorefront) => {
  const s = usarSuite({ seed: { tipoStorefront } });
  it('403 en config, prueba de cliente y el evento Cliente', async () => {
    const d = apiRol(s.h, s.base, 'DUENO');
    expectError(await d.get(`${BASE}/clientes/config`), 403, 'El resumen semanal solo está disponible para negocios de mayoreo');
    expectError(
      await d.post(`${BASE}/clientes/prueba`).send({ clienteId: '00000000-0000-4000-8000-000000000000', correo: 'a@b.co' }),
      403,
      'El resumen semanal solo está disponible para negocios de mayoreo',
    );
    const canal = await s.h.prisma.notificacionCanalConfig.create({
      data: { tenantId: s.base.tenant.id, tipo: 'CORREO', config: { nombreRemitente: 'X' } },
    });
    expect(
      (await d.post('/notificaciones/eventos').send({ evento: 'RESUMEN_SEMANAL', audiencia: 'CLIENTE', canalConfigId: canal.id })).status,
    ).toBe(403);
  });
});
