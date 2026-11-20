import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { ReglaBarridoService } from '../../src/notificaciones-reglas/regla-barrido.service';
import { ReglaCandadoService } from '../../src/notificaciones-reglas/regla-candado.service';
import { ReglaEnvioService } from '../../src/notificaciones-reglas/regla-envio.service';
import { ReglasFiltroService } from '../../src/notificaciones-reglas/reglas-filtro.service';
import { apiRol } from './b2b-helpers';
import { usarSuite } from './helpers';

// Botón de URL dinámica con el número de reserva ({numeroReserva}) en reglas RESERVA_AUTOMATICA. Barrido y «Ejecutar ahora»
// reales con el ReglaEnvioService REAL; solo `fetch` (la frontera con Botpress) es un espía.
const HOY = '2026-09-30';
const DIA_MS = 24 * 60 * 60 * 1000;
const ymd = (offset: number) => new Date(new Date(`${HOY}T00:00:00.000Z`).getTime() + offset * DIA_MS).toISOString().slice(0, 10);

const reserva = (id: string | number, n: number) => ({
  booking_id: id,
  status: 'confirmed',
  currency_code: 'USD',
  source: 'booking.com',
  total_amount_after_tax: '100.00',
  checkin: ymd(3),
  checkout: ymd(5),
  adults: 2,
  children: 0,
  online_checkin_url: `https://hotel.amenitiz.io/booking/token-secreto-${n}/online-check-in`,
  booker: { first_name: 'Huesped', last_name: String(n), email: '', phone: `+1 818 555 ${String(3000 + n)}`, language: 'ES' },
  rooms: [{ individual_room_name: 'Superior', individual_room_number: n }],
});

describe('Reglas RESERVA_AUTOMATICA · botón con el número de reserva', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'HOTEL' } });
  let barrido: ReglaBarridoService;
  let fetchMock: jest.SpyInstance;
  const cuerpos = () => fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));

  const ingestar = async (b: object) => {
    const res = await request(s.h.app.getHttpServer()).post('/internal/reservas/amenitiz').set('X-Api-Key', `key-${s.base.tenant.slug}`).send(b);
    expect(res.status).toBe(200);
    return res.body as { ordenId: string };
  };
  const crearRegla = (botonUrlValor: string | null) =>
    s.h.prisma.regla.create({
      data: {
        tenantId: s.base.tenant.id,
        nombre: 'Encuesta',
        trigger: 'RESERVA_AUTOMATICA',
        triggerConfig: { frecuencia: 'CADA_HORA' },
        filtro: [{ campo: 'DIAS_PARA_CHECKIN', operador: 'MAYOR_IGUAL', valor: 0 }],
        canal: 'WHATSAPP',
        plantillaNombre: 'encuesta_checkout',
        plantillaIdioma: 'es_MX',
        plantillaCategoria: 'UTILITY',
        plantillaVariables: [],
        botonUrlValor,
        activa: true,
      } as any,
    });

  beforeEach(async () => {
    await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { botWebhookUrl: 'http://localhost:9/hook' } });
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response);
    const envio = new ReglaEnvioService(s.h.prisma, { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService);
    barrido = new ReglaBarridoService(s.h.prisma, new ReglasFiltroService(s.h.prisma), new ReglaCandadoService(s.h.prisma), envio);
  });
  afterEach(() => fetchMock.mockRestore());

  it('el barrido manda a Botpress un valor de botón distinto por reserva', async () => {
    await crearRegla('{numeroReserva}');
    await ingestar(reserva(9641816459, 1));
    await ingestar(reserva('AB 12/3', 2));
    await barrido.ejecutarBarrido();
    const botones = cuerpos().map((c) => c.boton);
    expect(botones).toHaveLength(2);
    expect(botones).toEqual(expect.arrayContaining([
      { tipo: 'URL_DINAMICA', indice: 0, valor: '9641816459' },
      { tipo: 'URL_DINAMICA', indice: 0, valor: 'AB%2012%2F3' },
    ]));
    // El enlace de check-in (token) no viaja en el botón.
    expect(JSON.stringify(cuerpos())).not.toContain('token-secreto');
  });

  it('«Ejecutar ahora» manda lo mismo que el barrido', async () => {
    const regla = await crearRegla('{numeroReserva}');
    await ingestar(reserva(777001, 1));
    const resumen = await barrido.ejecutarReservaAhora(regla.id, s.base.tenant.id);
    expect(resumen).toMatchObject({ reservasEvaluadas: 1, enviadas: 1, fallidas: 0 });
    expect(cuerpos()[0].boton).toEqual({ tipo: 'URL_DINAMICA', indice: 0, valor: '777001' });
  });

  it('un folio inválido (demasiado largo) no envía ni deja registro y se reevalúa en el siguiente barrido', async () => {
    const regla = await crearRegla('{numeroReserva}');
    await ingestar(reserva('9'.repeat(201), 1));
    await barrido.ejecutarBarrido();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await s.h.prisma.reglaEnvioLog.count({ where: { reglaId: regla.id } })).toBe(0);
    const resumen = await barrido.ejecutarReservaAhora(regla.id, s.base.tenant.id);
    expect(resumen).toMatchObject({ reservasEvaluadas: 1, enviadas: 0, fallidas: 1 });
    expect(await s.h.prisma.reglaEnvioLog.count({ where: { reglaId: regla.id } })).toBe(0);
  });

  it('botón fijo y sin botón envían exactamente lo de siempre', async () => {
    await crearRegla('encuesta-xyz');
    await ingestar(reserva(555001, 1));
    await barrido.ejecutarBarrido();
    expect(cuerpos()[0].boton).toEqual({ tipo: 'URL_DINAMICA', indice: 0, valor: 'encuesta-xyz' });

    fetchMock.mockClear();
    await s.h.prisma.reglaEnvioLog.deleteMany({});
    await s.h.prisma.regla.deleteMany({});
    await crearRegla(null);
    await barrido.ejecutarBarrido();
    expect(Object.keys(cuerpos()[0])).not.toContain('boton');
  });

  describe('API: crear y editar la regla', () => {
    const cuerpo = (extra: Record<string, unknown> = {}) => ({
      nombre: 'Encuesta',
      trigger: 'RESERVA_AUTOMATICA',
      triggerConfig: { frecuencia: 'DIARIA', hora: 10 },
      filtro: [{ campo: 'DIAS_DESDE_CHECKOUT', operador: 'IGUAL', valor: 0 }],
      plantillaNombre: 'encuesta_checkout',
      plantillaIdioma: 'es_MX',
      plantillaCategoria: 'UTILITY',
      plantillaVariables: [{ posicion: 1, fuente: 'CAMPO_RESERVA', valor: 'nombreHuespedMayusculas' }],
      botonUrlValor: '{numeroReserva}',
      ...extra,
    });
    const dueno = () => apiRol(s.h, s.base, 'DUENO');

    it('se crea con el marcador, se lee de vuelta y una edición sin tocar el botón (como la del panel) lo conserva', async () => {
      const creada = await dueno().post('/reglas').send(cuerpo());
      expect(creada.status).toBe(201);
      expect(creada.body.botonUrlValor).toBe('{numeroReserva}');
      const editada = await dueno().patch(`/reglas/${creada.body.id}`).send({ nombre: 'Encuesta v2', plantillaVariables: cuerpo().plantillaVariables });
      expect(editada.status).toBe(200);
      expect(editada.body.botonUrlValor).toBe('{numeroReserva}');
      // Cambiar a texto fijo, y volver al marcador.
      expect((await dueno().patch(`/reglas/${creada.body.id}`).send({ botonUrlValor: 'fijo' })).body.botonUrlValor).toBe('fijo');
      expect((await dueno().patch(`/reglas/${creada.body.id}`).send({ botonUrlValor: '{numeroReserva}' })).body.botonUrlValor).toBe('{numeroReserva}');
      expect((await dueno().patch(`/reglas/${creada.body.id}`).send({ botonUrlValor: null })).body.botonUrlValor).toBeNull();
    });

    it('el valor fijo conserva sus validaciones', async () => {
      for (const malo of ['https://tally.so/r/x', '/x', 'a b']) {
        expect((await dueno().post('/reglas').send(cuerpo({ botonUrlValor: malo }))).status).toBe(400);
      }
      expect(await s.h.prisma.regla.count()).toBe(0);
    });

    it('el marcador solo vale en reglas de reservas; al cambiar de trigger se quita', async () => {
      const manual = cuerpo({ trigger: 'MANUAL', triggerConfig: undefined, filtro: [], plantillaVariables: [] });
      const rechazada = await dueno().post('/reglas').send(manual);
      expect(rechazada.status).toBe(400);
      expect(rechazada.body.message).toContain('RESERVA_AUTOMATICA');
      const creada = await dueno().post('/reglas').send(cuerpo());
      const aManual = await dueno().patch(`/reglas/${creada.body.id}`).send({ trigger: 'MANUAL', plantillaVariables: [] });
      expect(aManual.status).toBe(200);
      expect(aManual.body.botonUrlValor).toBeNull();
    });
  });
});
