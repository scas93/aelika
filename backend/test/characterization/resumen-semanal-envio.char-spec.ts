import { seedBase } from './db';
import { usarSuite } from './helpers';
import { crearAdminB2b, SEMANA_ACTUAL } from './b2b-helpers';
import { ResumenSemanalArmadoService } from '../../src/resumen-semanal/resumen-semanal-armado.service';
import { ResumenSemanalBarridoService } from '../../src/resumen-semanal/resumen-semanal-barrido.service';
import { ResumenSemanalEnvioService } from '../../src/resumen-semanal/resumen-semanal-envio.service';
import { semanaAnterior } from '../../src/resumen-semanal/resumen-semanal';

// Resumen semanal por correo: envío PROGRAMADO (lunes 10:00 CDMX), duplicados y registro de envíos. Reloj de la suite: miércoles
// 2026-09-30 10:00 CDMX. El lunes 2026-10-05 resume la semana 2026-09-28 (SEMANA_ACTUAL). Resend es un fake (fakes.correoEnviarConAdjuntos).
const LUNES_0959 = '2026-10-05T15:59:00.000Z';
const LUNES_1000 = '2026-10-05T16:00:00.000Z';
const LUNES_1430 = '2026-10-05T20:30:00.000Z';
const LUNES_2359 = '2026-10-06T05:59:00.000Z';
const MARTES_0000 = '2026-10-06T06:00:00.000Z';
const SEMANA = { inicio: SEMANA_ACTUAL, fin: '2026-10-04' };

describe('Resumen semanal · envío programado (mayoreo)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const ir = (iso: string) => jest.setSystemTime(new Date(iso));
  const enviar = () => s.h.fakes.correoEnviarConAdjuntos;
  const servicios = () => {
    const envio = new ResumenSemanalEnvioService(s.h.prisma, new ResumenSemanalArmadoService(s.h.prisma), { enviarConAdjuntos: enviar() } as any);
    return { envio, barrido: new ResumenSemanalBarridoService(s.h.prisma, envio) };
  };

  /** Canal Correo + evento del resumen, directo en la base (la configuración por API se cubre en notificaciones-resumen-config). */
  const activar = async (tenantId = s.base.tenant.id, config: unknown = { nombreRemitente: 'Banetto', correos: ['ana@example.com', 'luis@example.com'] }, extra: { canalActivo?: boolean; eventoActivo?: boolean } = {}) => {
    const canal = await s.h.prisma.notificacionCanalConfig.create({ data: { tenantId, tipo: 'CORREO', config: config as any, activo: extra.canalActivo ?? true } });
    await s.h.prisma.notificacionEventoConfig.create({
      data: { tenantId, evento: 'RESUMEN_SEMANAL', audiencia: 'NEGOCIO', canalConfigId: canal.id, activo: extra.eventoActivo ?? true },
    });
    return canal;
  };
  const pedido = (base = s.base, semanaInicio = SEMANA_ACTUAL, n = Math.random()) =>
    crearAdminB2b(s.h, base, { negocioNombre: `Cliente ${n}`, contactoTelefono: `55${String(Math.floor(n * 1e8)).padStart(8, '0')}`, semanaInicio });
  const registros = (tenantId = s.base.tenant.id) => s.h.prisma.resumenSemanalEnvio.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });

  describe('ventana lunes 10:00 CDMX', () => {
    it('no envía antes de las 10:00 ni otros días; el lunes desde las 10:00 envía una vez con asunto, lista y Excel', async () => {
      await activar();
      await pedido();
      const { barrido } = servicios();
      expect((await barrido.ejecutar()).enVentana).toBe(false); // miércoles
      ir(LUNES_0959);
      await barrido.ejecutar();
      expect(enviar()).not.toHaveBeenCalled();

      ir(LUNES_1000);
      const stats = await barrido.ejecutar();
      expect(stats).toMatchObject({ enVentana: true, negocios: 1, enviados: 1, fallidos: 0, duplicados: 0 });
      expect(enviar()).toHaveBeenCalledTimes(1);
      const arg = enviar().mock.calls[0][0];
      expect(arg.destinatarios).toEqual(['ana@example.com', 'luis@example.com']);
      expect(arg.nombreRemitente).toBe('Banetto');
      expect(arg.mensaje.asunto).toContain('Resumen semanal');
      expect(arg.mensaje.asunto).toContain('28 de septiembre al 4 de octubre');
      expect(arg.adjuntos).toHaveLength(1);
      expect(arg.adjuntos[0].nombreArchivo).toMatch(/^Pedidos .* 2026-09-28 al 2026-10-04\.xlsx$/);
      expect(Buffer.isBuffer(arg.adjuntos[0].contenido)).toBe(true);

      const [r] = await registros();
      expect(r).toMatchObject({ tipo: 'PROGRAMADO', estado: 'EXITO', destinatarios: 2, conPedidos: true, motivo: null });
      expect(r.resueltoAt).not.toBeNull();
      expect(r.semanaInicio.toISOString().slice(0, 10)).toBe(SEMANA_ACTUAL);
    });

    it('servidor caído a las 10: sale al volver ese mismo lunes (14:30) y no se repite; el martes 00:00 ya no sale', async () => {
      await activar();
      await pedido();
      const { barrido } = servicios();
      ir(LUNES_1430);
      await barrido.ejecutar();
      ir(LUNES_2359);
      expect((await barrido.ejecutar()).duplicados).toBe(1);
      expect(enviar()).toHaveBeenCalledTimes(1);
      ir(MARTES_0000);
      expect((await barrido.ejecutar()).enVentana).toBe(false);
      expect(enviar()).toHaveBeenCalledTimes(1);
    });

    it('si el servidor no volvió ese lunes, esa semana se pierde (nada sale el martes)', async () => {
      await activar();
      await pedido();
      const { barrido } = servicios();
      ir(MARTES_0000);
      await barrido.ejecutar();
      expect(enviar()).not.toHaveBeenCalled();
      expect(await registros()).toHaveLength(0);
    });
  });

  describe('duplicados', () => {
    it('dos ejecuciones simultáneas (dos instancias) para el mismo negocio y semana: un solo correo y un solo registro', async () => {
      await activar();
      await pedido();
      const a = servicios();
      const b = servicios();
      ir(LUNES_1000);
      const [x, y] = await Promise.all([a.barrido.ejecutar(), b.barrido.ejecutar()]);
      expect(enviar()).toHaveBeenCalledTimes(1);
      expect(x.enviados + y.enviados).toBe(1);
      expect(x.duplicados + y.duplicados).toBe(1);
      expect(await registros()).toHaveLength(1);
    });

    it('tras un reinicio (servicios nuevos) el mismo lunes no se vuelve a enviar', async () => {
      await activar();
      await pedido();
      ir(LUNES_1000);
      await servicios().barrido.ejecutar();
      await servicios().barrido.ejecutar();
      expect(enviar()).toHaveBeenCalledTimes(1);
    });

    it('la semana siguiente sí vuelve a enviar (una por negocio y semana)', async () => {
      await activar();
      const { barrido } = servicios();
      ir(LUNES_1000);
      await barrido.ejecutar();
      ir('2026-10-12T16:00:00.000Z');
      await barrido.ejecutar();
      expect(enviar()).toHaveBeenCalledTimes(2);
      expect((await registros()).map((r) => r.semanaInicio.toISOString().slice(0, 10))).toEqual(['2026-09-28', '2026-10-05']);
    });
  });

  describe('a quién se le envía', () => {
    it('solo con canal Correo activo Y evento activo; inactivos, sin evento y negocios que no son de mayoreo no envían', async () => {
      const otroA = await seedBase(s.h.prisma, { slug: 'canal-off', tipoStorefront: 'RETAIL_B2B' });
      const otroB = await seedBase(s.h.prisma, { slug: 'evento-off', tipoStorefront: 'RETAIL_B2B' });
      const otroC = await seedBase(s.h.prisma, { slug: 'sin-evento', tipoStorefront: 'RETAIL_B2B' });
      const menudeo = await seedBase(s.h.prisma, { slug: 'menudeo', tipoStorefront: 'RETAIL_B2C' });
      await activar(otroA.tenant.id, undefined, { canalActivo: false });
      await activar(otroB.tenant.id, undefined, { eventoActivo: false });
      await s.h.prisma.notificacionCanalConfig.create({ data: { tenantId: otroC.tenant.id, tipo: 'CORREO', config: { nombreRemitente: 'X', correos: ['a@b.co'] } } });
      await activar(menudeo.tenant.id);
      ir(LUNES_1000);
      const stats = await servicios().barrido.ejecutar();
      expect(stats.negocios).toBe(0);
      expect(enviar()).not.toHaveBeenCalled();
    });

    it('cada negocio con su propia lista, su propio resumen y su propio registro', async () => {
      const otro = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
      await activar();
      await activar(otro.tenant.id, { nombreRemitente: 'Otro', correos: ['otro@example.com'] });
      await pedido();
      ir(LUNES_1000);
      await servicios().barrido.ejecutar();
      expect(enviar()).toHaveBeenCalledTimes(2);
      const porLista = Object.fromEntries(enviar().mock.calls.map(([a]) => [a.destinatarios.join(','), a]));
      expect(porLista['otro@example.com'].adjuntos).toBeUndefined(); // sin pedidos → correo corto
      expect(porLista['otro@example.com'].mensaje.texto).toContain('Sin pedidos esta semana');
      expect(porLista['ana@example.com,luis@example.com'].adjuntos).toHaveLength(1);
      expect(await registros()).toHaveLength(1);
      expect(await registros(otro.tenant.id)).toHaveLength(1);
    });
  });

  describe('fallos', () => {
    it('Resend rechaza: queda FALLO con motivo (sin direcciones), definitivo para la semana, y no impide a los demás negocios', async () => {
      const otro = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
      await activar();
      await activar(otro.tenant.id, { nombreRemitente: 'Otro', correos: ['otro@example.com'] });
      enviar().mockImplementation(async (p: { destinatarios: string[] }) =>
        p.destinatarios.includes('ana@example.com') ? { exito: false, error: 'Resend: The to address ana@example.com is invalid' } : { exito: true },
      );
      ir(LUNES_1000);
      const { barrido } = servicios();
      const stats = await barrido.ejecutar();
      expect(stats).toMatchObject({ negocios: 2, enviados: 1, fallidos: 1 });
      const [fallo] = await registros();
      expect(fallo.estado).toBe('FALLO');
      expect(fallo.motivo).toBe('Resend: The to address ***@*** is invalid');
      expect((await registros(otro.tenant.id))[0].estado).toBe('EXITO');

      // Sin reintentos: otra pasada el mismo lunes no vuelve a enviar a nadie.
      await barrido.ejecutar();
      expect(enviar()).toHaveBeenCalledTimes(2);
    });

    it('sin RESEND_API_KEY: se registra el fallo y nada se rompe', async () => {
      await activar();
      enviar().mockResolvedValue({ exito: false, error: 'RESEND_API_KEY no está configurado en este ambiente' });
      ir(LUNES_1000);
      await servicios().barrido.ejecutar();
      expect(await registros()).toMatchObject([{ estado: 'FALLO', motivo: 'RESEND_API_KEY no está configurado en este ambiente' }]);
    });

    it('canal activo sin dirección válida: FALLO registrado, sin llamar a Resend', async () => {
      await activar(s.base.tenant.id, { nombreRemitente: 'Banetto', correos: ['mala'] });
      ir(LUNES_1000);
      await servicios().barrido.ejecutar();
      expect(enviar()).not.toHaveBeenCalled();
      expect(await registros()).toMatchObject([{ estado: 'FALLO', destinatarios: 0, motivo: 'El canal de correo no tiene direcciones válidas' }]);
    });

    it('Resend lanza una excepción: queda FALLO y el barrido sigue', async () => {
      await activar();
      enviar().mockRejectedValue(new Error('socket hang up'));
      ir(LUNES_1000);
      const stats = await servicios().barrido.ejecutar();
      expect(stats.fallidos).toBe(1);
      expect(await registros()).toMatchObject([{ estado: 'FALLO', motivo: 'socket hang up' }]);
    });

    it('el registro nunca guarda direcciones de correo', async () => {
      await activar();
      enviar().mockResolvedValue({ exito: false, error: 'rechazado ana@example.com y luis@example.com' });
      ir(LUNES_1000);
      await servicios().barrido.ejecutar();
      expect(JSON.stringify(await registros())).not.toMatch(/@example\.com/);
    });
  });

  describe('botón de prueba (servicio)', () => {
    it('envía en el momento, se registra como PRUEBA, se puede repetir y NO bloquea el envío programado del lunes', async () => {
      await activar();
      await pedido();
      const { envio, barrido } = servicios();
      const config = { nombreRemitente: 'Banetto', correos: ['ana@example.com'] };
      const a = await envio.enviar(s.base.tenant.id, SEMANA, 'PRUEBA', config);
      const b = await envio.enviar(s.base.tenant.id, SEMANA, 'PRUEBA', config);
      expect([a.resultado, b.resultado]).toEqual(['EXITO', 'EXITO']);
      expect(enviar()).toHaveBeenCalledTimes(2);
      ir(LUNES_1000);
      expect((await barrido.ejecutar()).enviados).toBe(1);
      expect(enviar()).toHaveBeenCalledTimes(3);
      expect((await registros()).map((r) => r.tipo)).toEqual(['PRUEBA', 'PRUEBA', 'PROGRAMADO']);
    });
  });

  it('semanaAnterior del reloj de la prueba coincide con la semana usada aquí', () => {
    ir(LUNES_1000);
    expect(semanaAnterior(new Date())).toEqual(SEMANA);
  });
});
