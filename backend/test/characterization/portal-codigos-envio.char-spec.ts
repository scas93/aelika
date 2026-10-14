import { Logger } from '@nestjs/common';
import request from 'supertest';
import { seedBase } from './db';
import { usarSuite } from './helpers';
import { crearClienteB2b } from '../../src/clientes/cliente-b2b';
import {
  EstadoEnvioCodigoService,
  claveEnvioCodigo,
} from '../../src/portal/estado-envio-codigo.service';

// Fase 4 · 4g · envío del código de acceso por WhatsApp (lado Aelika) y su callback propio. Botpress NUNCA se contacta:
// el envío está simulado en el harness (el payload exacto lo cubre enviar-codigo-acceso.service.spec.ts).
describe('Portal · envío del código y callback (4g)', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const http = () => request(s.h.app.getHttpServer());
  const H = { 'x-portal-request': '1' };
  const TEL = '3331006915';
  const MENSAJE =
    'Si tu número está dado de alta, recibirás un código por WhatsApp. Si no te llega en unos minutos, contáctanos';

  const entorno = { ...process.env };
  beforeEach(() => {
    process.env.PORTAL_CODIGO_EN_LOG = 'false'; // el código nunca debe estar en el registro
    delete process.env.RAILWAY_PROJECT_NAME;
  });
  afterEach(() => {
    process.env = { ...entorno };
    jest.restoreAllMocks();
  });

  const slug = () => s.base.tenant.slug;
  const configurar = (data: Record<string, unknown> = {}) =>
    s.h.prisma.tenant.update({
      where: { id: s.base.tenant.id },
      data: {
        botWebhookUrl: 'https://bp.test/hook',
        portalPlantillaNombre: 'auth',
        portalPlantillaIdioma: 'es',
        ...data,
      } as never,
    });
  const alta = () =>
    crearClienteB2b(s.h.prisma, {
      tenantId: s.base.tenant.id,
      tenantSlug: slug(),
      sufijo: 'aurora',
      nombre: 'Café Aurora',
      direccion: 'Calle 1',
      telefonos: [{ telefono: TEL, principal: true }],
    });
  const pedir = (telefono = TEL, ip?: string) => {
    let r = http().post('/portal/acceso/pedir-codigo').set(H);
    if (ip) r = r.set('x-forwarded-for', ip);
    return r.send({ slug: slug(), telefono });
  };
  const estados = () => s.h.app.get(EstadoEnvioCodigoService);
  // Llave de bot del negocio de la prueba (la base la genera al sembrar).
  let llave = '';
  beforeEach(async () => {
    llave = (
      await s.h.prisma.tenant.findUniqueOrThrow({
        where: { id: s.base.tenant.id },
        select: { botApiKey: true },
      })
    ).botApiKey;
  });
  // Callback con la llave del negocio (o con `apiKey`; `null` = sin encabezado).
  const callback = (id: string, body: unknown, apiKey?: string | null) => {
    let r = http().patch(`/internal/portal-codigos/${id}/estado`);
    if (apiKey !== null) r = r.set('X-Api-Key', apiKey ?? llave);
    return r.send(body as object);
  };

  // ------------------------------------------------------------------ lo que ve el cliente
  describe('pedir código: el cliente ve siempre lo mismo', () => {
    it('envío exitoso, fallido, con error y sin respuesta: misma respuesta HTTP', async () => {
      await configurar();
      await alta();
      // Segundo cliente (otro teléfono): el límite es de 3 códigos por hora por teléfono.
      await crearClienteB2b(s.h.prisma, {
        tenantId: s.base.tenant.id,
        tenantSlug: slug(),
        sufijo: 'norte',
        nombre: 'Café Norte',
        direccion: 'Calle 2',
        telefonos: [{ telefono: '3331112222', principal: true }],
      });
      const respuestas: unknown[] = [];
      const casos: Array<() => void> = [
        () =>
          s.h.fakes.enviarCodigoAcceso.mockResolvedValue({
            enviado: true,
            correlacionId: 'x',
          }),
        () =>
          s.h.fakes.enviarCodigoAcceso.mockResolvedValue({
            enviado: false,
            motivo: 'HTTP 500',
          }),
        () => s.h.fakes.enviarCodigoAcceso.mockRejectedValue(new Error('boom')),
        // Botpress que nunca responde: la promesa no se resuelve y la respuesta HTTP no la espera.
        () =>
          s.h.fakes.enviarCodigoAcceso.mockReturnValue(new Promise(() => {})),
      ];
      let i = 0;
      for (const preparar of casos) {
        preparar();
        // IP distinta por caso: el límite por IP no es lo que se prueba aquí.
        const r = await pedir(
          i < 3 ? TEL : '3331112222',
          `10.0.0.${(i += 1)}`,
        ).expect(200);
        respuestas.push({ status: r.status, body: r.body });
      }
      for (const r of respuestas)
        expect(r).toEqual({
          status: 200,
          body: { ok: true, mensaje: MENSAJE },
        });
    });

    it('un número que no es cliente recibe el mismo mensaje y no se envía nada', async () => {
      await configurar();
      await alta();
      const r = await pedir('5599998888').expect(200);
      expect(r.body).toEqual({ ok: true, mensaje: MENSAJE });
      expect(s.h.fakes.enviarCodigoAcceso).not.toHaveBeenCalled();
    });

    it('lleva al envío el negocio, la plantilla y el idioma del negocio', async () => {
      await configurar({ portalPlantillaIdioma: 'es' });
      await alta();
      await pedir().expect(200);
      expect(s.h.fakes.enviarCodigoAcceso).toHaveBeenCalledTimes(1);
      expect(s.h.fakes.enviarCodigoAcceso.mock.calls[0][0]).toMatchObject({
        tenantId: s.base.tenant.id,
        tenantSlug: slug(),
        plantillaNombre: 'auth',
        plantillaIdioma: 'es',
        botWebhookUrl: 'https://bp.test/hook',
        telefono: TEL,
      });
    });
  });

  describe('sin idioma de plantilla el acceso queda inerte', () => {
    it('misma respuesta, sin generar código ni consumir límites', async () => {
      await configurar({ portalPlantillaIdioma: null });
      await alta();
      // Más de 3 en la hora: si consumiera límites, el 4.º daría 429.
      for (let i = 0; i < 5; i += 1) {
        const r = await pedir().expect(200);
        expect(r.body).toEqual({ ok: true, mensaje: MENSAJE });
      }
      expect(s.h.fakes.enviarCodigoAcceso).not.toHaveBeenCalled();
      // No se generó ningún código: verificar no tiene nada que comparar.
      await http()
        .post('/portal/acceso/verificar')
        .set(H)
        .send({ slug: slug(), telefono: TEL, codigo: '000000' })
        .expect(401);
    });
  });

  describe('Redis caído sigue fallando cerrado', () => {
    it('pedir código → 503 y no se envía nada', async () => {
      await configurar();
      await alta();
      s.h.fakes.codigos.caido = true;
      await pedir().expect(503);
      expect(s.h.fakes.enviarCodigoAcceso).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------ callback
  describe('PATCH /internal/portal-codigos/:id/estado', () => {
    it('sin X-Api-Key o con una incorrecta → 401', async () => {
      await estados().registrar('envio-1', s.base.tenant.id);
      await callback('envio-1', { estado: 'EXITO' }, null).expect(401);
      await callback('envio-1', { estado: 'EXITO' }, 'llave-incorrecta').expect(
        401,
      );
      expect((await estados().leer('envio-1'))?.estado).toBe('EN_CURSO');
    });

    it('con la llave correcta: EN_CURSO → EXITO', async () => {
      await estados().registrar('envio-2', s.base.tenant.id);
      const r = await callback('envio-2', { estado: 'EXITO' }).expect(200);
      expect(r.body).toEqual({ id: 'envio-2', estado: 'EXITO' });
      expect((await estados().leer('envio-2'))?.estado).toBe('EXITO');
    });

    it('EN_CURSO → FALLO con motivo; deja un warn con el negocio, sin teléfono ni código', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      await estados().registrar('envio-3', s.base.tenant.id);
      const r = await callback('envio-3', {
        estado: 'FALLO',
        motivo: `Meta rechazó el envío a 52${TEL}\ncódigo 482915`,
      }).expect(200);
      expect(r.body).toEqual({ id: 'envio-3', estado: 'FALLO' });
      const reg = await estados().leer('envio-3');
      expect(reg?.estado).toBe('FALLO');
      expect(reg?.motivo).toBe('Meta rechazó el envío a *** código ***');

      const log = warn.mock.calls.map((c) => String(c[0])).join('\n');
      expect(log).toContain(slug());
      expect(log).toContain('envio-3');
      expect(log).not.toContain(TEL);
      expect(log).not.toContain('482915');
    });

    it('un estado terminal no cambia: EXITO y luego FALLO sigue EXITO (y sin warn)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      await estados().registrar('envio-4', s.base.tenant.id);
      await callback('envio-4', { estado: 'EXITO' }).expect(200);
      const r = await callback('envio-4', { estado: 'FALLO' }).expect(200);
      expect(r.body.estado).toBe('EXITO');
      expect(warn).not.toHaveBeenCalled();
    });

    it('correlacionId inexistente o de otro negocio → 404, sin distinguirlos', async () => {
      const otro = await seedBase(s.h.prisma, {
        slug: 'otro-mayoreo',
        tipoStorefront: 'RETAIL_B2B',
      });
      await estados().registrar('envio-ajeno', otro.tenant.id);
      const ajeno = await callback('envio-ajeno', { estado: 'EXITO' }).expect(
        404,
      );
      const nada = await callback('no-existe', { estado: 'EXITO' }).expect(404);
      expect(ajeno.body.message).toBe(nada.body.message);
      // El del otro negocio quedó intacto; con su propia llave sí lo cierra.
      expect((await estados().leer('envio-ajeno'))?.estado).toBe('EN_CURSO');
      await callback(
        'envio-ajeno',
        { estado: 'EXITO' },
        (
          await s.h.prisma.tenant.findUniqueOrThrow({
            where: { id: otro.tenant.id },
          })
        ).botApiKey,
      ).expect(200);
    });

    it('cuerpo inválido → 400', async () => {
      await estados().registrar('envio-5', s.base.tenant.id);
      await callback('envio-5', { estado: 'EN_CURSO' }).expect(400);
      await callback('envio-5', {}).expect(400);
      await callback('envio-5', {
        estado: 'FALLO',
        motivo: 'x'.repeat(501),
      }).expect(400);
    });

    it('un callback tardío tras el vencimiento del registro (TTL) → 404', async () => {
      await estados().registrar('envio-6', s.base.tenant.id);
      // Simula el TTL de 24 h vencido.
      await s.h.fakes.codigos.borrar(claveEnvioCodigo('envio-6'));
      await callback('envio-6', { estado: 'EXITO' }).expect(404);
    });

    it('Redis caído → 503', async () => {
      await estados().registrar('envio-7', s.base.tenant.id);
      s.h.fakes.codigos.caido = true;
      await callback('envio-7', { estado: 'EXITO' }).expect(503);
    });
  });
});
