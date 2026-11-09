import { auth, usarSuite } from './helpers';
import { apiRol, crearAdminB2b, SEMANA_PASADA } from './b2b-helpers';
import { expectError } from './exacto';

// Botón «Enviar resumen de prueba» (POST /notificaciones/resumen-semanal/prueba). Reloj: miércoles 2026-09-30 → semana anterior 2026-09-21.
const MSG_403 = 'No tienes permiso para realizar esta acción';
const RUTA = '/notificaciones/resumen-semanal/prueba';

describe('Resumen semanal · botón de prueba (mayoreo)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  const enviar = () => s.h.fakes.correoEnviarConAdjuntos;
  const canal = (
    config: unknown = {
      nombreRemitente: 'Banetto',
      correos: ['ana@example.com'],
    },
    activo = false,
  ) =>
    s.h.prisma.notificacionCanalConfig.create({
      data: {
        tenantId: s.base.tenant.id,
        tipo: 'CORREO',
        config: config as any,
        activo,
      },
    });
  const registros = () =>
    s.h.prisma.resumenSemanalEnvio.findMany({
      where: { tenantId: s.base.tenant.id },
      orderBy: { createdAt: 'asc' },
    });

  it('envía ahora el resumen de la semana anterior, aunque el canal siga inactivo, y lo registra como PRUEBA', async () => {
    await canal();
    await crearAdminB2b(s.h, s.base, {
      negocioNombre: 'Cliente',
      semanaInicio: SEMANA_PASADA,
    });
    const res = await dueno().post(RUTA).expect(200);
    expect(res.body).toEqual({
      resultado: 'EXITO',
      motivo: null,
      destinatarios: 1,
      conPedidos: true,
      semanaInicio: '2026-09-21',
      semanaFin: '2026-09-27',
    });
    expect(enviar()).toHaveBeenCalledTimes(1);
    expect(enviar().mock.calls[0][0]).toMatchObject({
      destinatarios: ['ana@example.com'],
      nombreRemitente: 'Banetto',
    });
    expect(await registros()).toMatchObject([
      {
        tipo: 'PRUEBA',
        estado: 'EXITO',
        destinatarios: 1,
        semanaProgramada: null,
      },
    ]);
  });

  it('dos pruebas seguidas: ambas se envían y se registran como prueba, y no afectan el envío del lunes', async () => {
    await canal();
    await dueno().post(RUTA).expect(200);
    await dueno().post(RUTA).expect(200);
    expect(enviar()).toHaveBeenCalledTimes(2);
    const filas = await registros();
    expect(filas.map((f) => f.tipo)).toEqual(['PRUEBA', 'PRUEBA']);
    expect(filas.every((f) => f.semanaProgramada === null)).toBe(true);
  });

  it('semana sin pedidos: se envía el correo corto sin adjunto', async () => {
    await canal();
    const res = await dueno().post(RUTA).expect(200);
    expect(res.body).toMatchObject({ resultado: 'EXITO', conPedidos: false });
    expect(enviar().mock.calls[0][0].adjuntos).toBeUndefined();
  });

  it('si el envío falla responde 200 con FALLO y el motivo, y queda registrado', async () => {
    await canal();
    enviar().mockResolvedValue({
      exito: false,
      error: 'Resend: dominio no verificado',
    });
    const res = await dueno().post(RUTA).expect(200);
    expect(res.body).toMatchObject({
      resultado: 'FALLO',
      motivo: 'Resend: dominio no verificado',
    });
    expect(await registros()).toMatchObject([
      { tipo: 'PRUEBA', estado: 'FALLO' },
    ]);
  });

  it('sin canal o sin direcciones → 409 y no se envía ni se registra nada', async () => {
    const msg =
      'Configura primero el canal de correo con al menos una dirección';
    expectError(await dueno().post(RUTA), 409, msg);
    await canal({ nombreRemitente: 'Banetto', correos: [] });
    expectError(await dueno().post(RUTA), 409, msg);
    expect(enviar()).not.toHaveBeenCalled();
    expect(await registros()).toHaveLength(0);
  });

  it('solo Dueño: Gerente y Operador 403, sin sesión 401', async () => {
    await canal();
    for (const rol of ['GERENTE', 'OPERADOR'] as const)
      expectError(await apiRol(s.h, s.base, rol).post(RUTA), 403, MSG_403);
    expect((await auth(s.h, 'x').post(RUTA)).status).toBe(401);
    expect(enviar()).not.toHaveBeenCalled();
  });
});

describe.each([['RETAIL_B2C'], ['HOTEL']] as const)(
  'Resumen semanal · botón de prueba NO aplica a %s',
  (tipoStorefront) => {
    const s = usarSuite({ seed: { tipoStorefront } });
    it('403 y no se envía nada', async () => {
      await s.h.prisma.notificacionCanalConfig.create({
        data: {
          tenantId: s.base.tenant.id,
          tipo: 'CORREO',
          config: { nombreRemitente: 'X', correos: ['a@b.co'] },
        },
      });
      expectError(
        await apiRol(s.h, s.base, 'DUENO').post(RUTA),
        403,
        'El resumen semanal solo está disponible para negocios de mayoreo',
      );
      expect(s.h.fakes.correoEnviarConAdjuntos).not.toHaveBeenCalled();
    });
  },
);
