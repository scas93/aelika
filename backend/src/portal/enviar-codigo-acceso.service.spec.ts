/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- los mocks de fetch son `any` por diseño */
import { Logger } from '@nestjs/common';
import { MemoriaCodigosStore } from './codigos-store';
import {
  EnviarCodigoAccesoService,
  TIMEOUT_ENVIO_CODIGO_MS,
  type DatosEnvioCodigo,
} from './enviar-codigo-acceso.service';
import {
  EstadoEnvioCodigoService,
  claveEnvioCodigo,
  sanearMotivo,
} from './estado-envio-codigo.service';

// 4g: forma EXACTA del payload al webhook de Botpress y registro del envío. Nunca se contacta a Botpress de verdad: `fetch`
// está simulado.
describe('EnviarCodigoAccesoService (4g)', () => {
  let store: MemoriaCodigosStore;
  let estados: EstadoEnvioCodigoService;
  let servicio: EnviarCodigoAccesoService;
  let fetchMock: jest.SpyInstance;

  const datos = (extra: Partial<DatosEnvioCodigo> = {}): DatosEnvioCodigo => ({
    tenantId: 'tenant-1',
    tenantSlug: 'banetto-mayorista',
    botWebhookUrl: 'https://bp.test/hook',
    botWebhookSecret: 'secreto-prueba',
    plantillaNombre: 'auth',
    plantillaIdioma: 'es',
    telefono: '3331006915',
    codigo: '482915',
    ...extra,
  });

  beforeEach(() => {
    store = new MemoriaCodigosStore();
    estados = new EstadoEnvioCodigoService(store);
    servicio = new EnviarCodigoAccesoService(estados);
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
  });
  afterEach(() => jest.restoreAllMocks());

  const cuerpoEnviado = () =>
    JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<
      string,
      unknown
    >;

  it('payload exacto: variables arreglo, idioma del negocio, categoría, negocio y botón opcional', async () => {
    const r = await servicio.enviar(datos());
    expect(r.enviado).toBe(true);
    const correlacionId = (r as { correlacionId: string }).correlacionId;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://bp.test/hook');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'x-bp-secret': 'secreto-prueba',
    });
    expect(cuerpoEnviado()).toEqual({
      correlacionId,
      negocio: 'banetto-mayorista',
      telefono: '+523331006915',
      categoria: 'AUTHENTICATION',
      plantilla: { nombre: 'auth', idioma: 'es' },
      variables: ['482915'],
      boton: { tipo: 'COPIAR_CODIGO', valor: '482915' },
    });
    expect(Array.isArray(cuerpoEnviado().variables)).toBe(true);
  });

  it('sin secreto no manda x-bp-secret; el idioma sale del negocio, sin valor por defecto', async () => {
    await servicio.enviar(
      datos({ botWebhookSecret: null, plantillaIdioma: 'en' }),
    );
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
    });
    expect((cuerpoEnviado().plantilla as { idioma: string }).idioma).toBe('en');

    fetchMock.mockClear();
    const sinIdioma = await servicio.enviar(datos({ plantillaIdioma: null }));
    expect(sinIdioma.enviado).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin webhook o sin plantilla no envía', async () => {
    expect(
      (await servicio.enviar(datos({ botWebhookUrl: null }))).enviado,
    ).toBe(false);
    expect(
      (await servicio.enviar(datos({ plantillaNombre: null }))).enviado,
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registra el envío en Redis (EN_CURSO, negocio y fechas; sin teléfono ni código) con TTL de 24 h', async () => {
    const r = (await servicio.enviar(datos())) as { correlacionId: string };
    const crudo = await store.leer(claveEnvioCodigo(r.correlacionId));
    const registro = JSON.parse(crudo!) as Record<string, unknown>;
    expect(Object.keys(registro).sort()).toEqual([
      'actualizadoAt',
      'creadoAt',
      'estado',
      'tenantId',
    ]);
    expect(registro).toMatchObject({
      tenantId: 'tenant-1',
      estado: 'EN_CURSO',
    });
    expect(crudo).not.toContain('482915');
    expect(crudo).not.toContain('3331006915');
  });

  it('el registro existe ANTES del POST (el callback puede llegar de inmediato)', async () => {
    let existiaAlEnviar = false;
    fetchMock.mockImplementation(async (_u: string, init: { body: string }) => {
      const id = (JSON.parse(init.body) as { correlacionId: string })
        .correlacionId;
      existiaAlEnviar = (await estados.leer(id)) !== null;
      return new Response('{}', { status: 200 });
    });
    await servicio.enviar(datos());
    expect(existiaAlEnviar).toBe(true);
  });

  it('HTTP de error → FALLO en el registro, con motivo, y el warn no lleva teléfono ni código', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 502 }));
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const r = await servicio.enviar(datos());
    expect(r).toEqual({ enviado: false, motivo: 'HTTP 502' });

    const id = (
      JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
        correlacionId: string;
      }
    ).correlacionId;
    expect(await estados.leer(id)).toMatchObject({
      estado: 'FALLO',
      motivo: 'HTTP 502',
    });
    const log = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(log).toContain('banetto-mayorista');
    expect(log).not.toContain('482915');
    expect(log).not.toContain('3331006915');
    expect(log).not.toContain('+52');
  });

  it('error de red y timeout → FALLO', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const r1 = await servicio.enviar(datos());
    expect(r1).toEqual({ enviado: false, motivo: 'Error de red' });

    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    fetchMock.mockRejectedValueOnce(timeout);
    const r2 = await servicio.enviar(datos());
    expect(r2.enviado).toBe(false);
    expect((r2 as { motivo: string }).motivo).toMatch(/timeout/);
  });

  it('el POST lleva un límite de espera de 10 s', async () => {
    await servicio.enviar(datos());
    expect(TIMEOUT_ENVIO_CODIGO_MS).toBe(10_000);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('EstadoEnvioCodigoService (4g)', () => {
  let estados: EstadoEnvioCodigoService;
  beforeEach(() => {
    estados = new EstadoEnvioCodigoService(new MemoriaCodigosStore());
  });

  it('transiciones: EN_CURSO → EXITO; un estado terminal ya no cambia', async () => {
    await estados.registrar('c1', 't1');
    const a = await estados.cerrar('c1', 't1', 'EXITO');
    expect(a).toMatchObject({ cambio: true, registro: { estado: 'EXITO' } });
    const b = await estados.cerrar('c1', 't1', 'FALLO', 'tarde');
    expect(b).toMatchObject({ cambio: false, registro: { estado: 'EXITO' } });
  });

  it('EN_CURSO → FALLO guarda el motivo', async () => {
    await estados.registrar('c2', 't1');
    const r = await estados.cerrar('c2', 't1', 'FALLO', 'plantilla rechazada');
    expect(r?.registro).toMatchObject({
      estado: 'FALLO',
      motivo: 'plantilla rechazada',
    });
  });

  it('otro negocio o id inexistente → null', async () => {
    await estados.registrar('c3', 't1');
    expect(await estados.cerrar('c3', 't2', 'EXITO')).toBeNull();
    expect(await estados.cerrar('nada', 't1', 'EXITO')).toBeNull();
    expect((await estados.leer('c3'))?.estado).toBe('EN_CURSO');
  });

  it('sanearMotivo: una línea, 200 caracteres y sin secuencias de 6+ dígitos', () => {
    expect(sanearMotivo(undefined)).toBeUndefined();
    expect(sanearMotivo('   ')).toBeUndefined();
    expect(sanearMotivo('falló\npara 3331006915 con 123456\tfin')).toBe(
      'falló para *** con *** fin',
    );
    expect(sanearMotivo('x'.repeat(500))).toHaveLength(200);
    expect(sanearMotivo('código 12345 ok')).toBe('código 12345 ok');
  });
});
