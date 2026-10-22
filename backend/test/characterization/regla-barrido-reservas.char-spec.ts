import { Logger } from '@nestjs/common';
import request from 'supertest';
import { ReglaBarridoService } from '../../src/notificaciones-reglas/regla-barrido.service';
import { ReglaCandadoService } from '../../src/notificaciones-reglas/regla-candado.service';
import { ReglaEnvioService, TIMEOUT_ENVIO_MS } from '../../src/notificaciones-reglas/regla-envio.service';
import { ReglasFiltroService } from '../../src/notificaciones-reglas/reglas-filtro.service';
import { seedBase } from './db';
import { apiRol } from './b2b-helpers';
import { usarSuite } from './helpers';

const HOY = '2026-09-30'; // AHORA de la suite = 10:00 CDMX
const DIA_MS = 24 * 60 * 60 * 1000;
const ymd = (offset: number) => new Date(new Date(`${HOY}T00:00:00.000Z`).getTime() + offset * DIA_MS).toISOString().slice(0, 10);
const CDMX = (hora: number, dia = HOY) => new Date(new Date(`${dia}T${String(hora).padStart(2, '0')}:00:00.000Z`).getTime() + 6 * 60 * 60 * 1000);

let seq = 0;
/** Reserva de Amenitiz con check-in/out relativos a HOY. */
const reserva = (checkInOffset: number, checkOutOffset: number, extra: { idioma?: string; status?: string; phone?: string } = {}) => {
  seq += 1;
  return {
    booking_id: 7000000000 + seq,
    status: extra.status ?? 'confirmed',
    currency_code: 'USD',
    source: 'booking.com',
    total_amount_after_tax: '100.00',
    checkin: ymd(checkInOffset),
    checkout: ymd(checkOutOffset),
    adults: 2,
    children: 1,
    online_checkin_url: `https://hotel.amenitiz.io/booking/token-secreto-${seq}/online-check-in`,
    booker: { first_name: 'Huesped', last_name: String(seq), email: '', phone: extra.phone ?? `+1 818 555 ${String(1000 + seq)}`, language: extra.idioma ?? 'ES' },
    rooms: [{ individual_room_name: 'Superior', individual_room_number: seq }],
  };
};

describe('Reglas RESERVA_AUTOMATICA · barrido sobre reservas de hotel', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'HOTEL' } });
  let estadoEnvio: 'EXITO' | 'FALLO' | 'EN_CURSO' = 'EXITO';
  let barrido: ReglaBarridoService;
  const enviar = jest.fn();

  const ingestar = async (b: object) => {
    const res = await request(s.h.app.getHttpServer()).post('/internal/reservas/amenitiz').set('X-Api-Key', `key-${s.base.tenant.slug}`).send(b);
    expect(res.status).toBe(200);
    return res.body as { ordenId: string; resultado: string };
  };
  const crearRegla = (extra: Record<string, unknown> = {}) =>
    s.h.prisma.regla.create({
      data: {
        tenantId: s.base.tenant.id,
        nombre: 'Reserva',
        trigger: 'RESERVA_AUTOMATICA',
        triggerConfig: { frecuencia: 'CADA_HORA' },
        filtro: [{ campo: 'DIAS_PARA_CHECKIN', operador: 'MAYOR_IGUAL', valor: 0 }],
        canal: 'WHATSAPP',
        plantillaNombre: 'reserva_confirmada',
        plantillaIdioma: 'es',
        plantillaCategoria: 'UTILITY',
        plantillaVariables: [],
        activa: true,
        ...extra,
      } as any,
    });
  /** Órdenes (por id) a las que `enviar` fue llamado. */
  const enviadas = () => enviar.mock.calls.map((c) => c[4] as string);
  const FILTRO_ES = { campo: 'IDIOMA_HUESPED', operador: 'ES', valor: 'ES' };
  const FILTRO_NO_ES = { campo: 'IDIOMA_HUESPED', operador: 'NO_ES', valor: 'ES' };
  const CHECKIN_FUTURO = { campo: 'DIAS_PARA_CHECKIN', operador: 'MAYOR_IGUAL', valor: 0 };

  beforeEach(async () => {
    seq = 0;
    estadoEnvio = 'EXITO';
    await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { botWebhookUrl: 'http://localhost:9/hook' } });
    enviar.mockReset().mockImplementation(async (tenant, cliente, regla, _contexto, orderId) =>
      s.h.prisma.reglaEnvioLog.create({
        data: { tenantId: tenant.id, clienteId: cliente.id, reglaId: regla.id, categoria: regla.plantillaCategoria, estado: estadoEnvio, orderId },
      }),
    );
    barrido = new ReglaBarridoService(s.h.prisma, new ReglasFiltroService(s.h.prisma), new ReglaCandadoService(s.h.prisma), { enviar } as any);
  });

  describe('un solo envío por regla y reserva', () => {
    it('cada hora: varios barridos no reenvían; una reserva nueva recibe en el siguiente; el registro guarda la orden', async () => {
      await crearRegla();
      const a = await ingestar(reserva(3, 5));
      await barrido.ejecutarBarrido();
      expect(enviadas()).toEqual([a.ordenId]);
      expect((await s.h.prisma.reglaEnvioLog.findFirstOrThrow()).orderId).toBe(a.ordenId);

      await barrido.ejecutarBarrido();
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(1);

      const b = await ingestar(reserva(10, 12));
      await barrido.ejecutarBarrido();
      expect(enviadas()).toEqual([a.ordenId, b.ordenId]);
    });

    it('pasa el contexto de la reserva al envío', async () => {
      await crearRegla();
      await ingestar(reserva(3, 5));
      await barrido.ejecutarBarrido();
      expect(enviar.mock.calls[0][3]).toMatchObject({ origen: 'RESERVA', adultos: 2, ninos: 1, habitaciones: 'Superior #1' });
    });

    it('FALLO es definitivo: no se reintenta', async () => {
      await crearRegla();
      await ingestar(reserva(3, 5));
      estadoEnvio = 'FALLO';
      await barrido.ejecutarBarrido();
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(1);
    });

    it('EN_CURSO cuenta como enviado', async () => {
      await crearRegla();
      await ingestar(reserva(3, 5));
      estadoEnvio = 'EN_CURSO';
      await barrido.ejecutarBarrido();
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(1);
    });

    it('un envío que lanza antes de intentarse no deja registro y se reevalúa en el siguiente barrido', async () => {
      await crearRegla();
      await ingestar(reserva(3, 5));
      enviar.mockRejectedValueOnce(new Error('sin webhook'));
      const primero = await barrido.ejecutarBarrido();
      expect(primero.enviosConError).toBe(1);
      expect(await s.h.prisma.reglaEnvioLog.count()).toBe(0);
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(2);
      expect(await s.h.prisma.reglaEnvioLog.count()).toBe(1);
    });

    it('una reserva cancelada no recibe; cancelar o reactivar después de recibir no reenvía; reactivada sin haber recibido, sí', async () => {
      await crearRegla();
      const canc = reserva(3, 5);
      await ingestar({ ...canc, status: 'cancelled' });
      const enviada = reserva(4, 6);
      const e = await ingestar(enviada);
      await barrido.ejecutarBarrido();
      expect(enviadas()).toEqual([e.ordenId]); // la cancelada no

      await ingestar({ ...enviada, status: 'cancelled' });
      await ingestar({ ...enviada, status: 'confirmed' });
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(1); // la ya enviada no se reenvía

      const react = await ingestar({ ...canc, status: 'confirmed' });
      await barrido.ejecutarBarrido();
      expect(enviadas()).toEqual([e.ordenId, react.ordenId]);
    });

    it('con el candado de Marketing: la bloqueada no deja registro y se envía cuando el candado se libera', async () => {
      await crearRegla({ plantillaCategoria: 'MARKETING' });
      const a = await ingestar(reserva(3, 5));
      const cliente = await s.h.prisma.cliente.findFirstOrThrow();
      await s.h.prisma.reglaEnvioLog.create({ data: { tenantId: s.base.tenant.id, clienteId: cliente.id, categoria: 'MARKETING', estado: 'EXITO' } });
      const bloqueado = await barrido.ejecutarBarrido();
      expect(enviar).not.toHaveBeenCalled();
      expect(bloqueado.enviosBloqueadosPorCandado).toBe(1);

      jest.setSystemTime(new Date(Date.now() + 8 * DIA_MS)); // la reserva sigue en la ventana (check-in ≥ 0 hace 8 días ya no)
      await s.h.prisma.detalleReserva.updateMany({ data: { checkIn: new Date(`${ymd(20)}T00:00:00.000Z`), checkOut: new Date(`${ymd(22)}T00:00:00.000Z`) } });
      await barrido.ejecutarBarrido();
      expect(enviadas()).toEqual([a.ordenId]);
    });
  });

  describe('frecuencia y hora de CDMX', () => {
    const diaria = (hora: number, extra: Record<string, unknown> = {}) =>
      crearRegla({ triggerConfig: { frecuencia: 'DIARIA', hora }, filtro: [{ campo: 'DIAS_DESDE_CHECKOUT', operador: 'IGUAL', valor: 1 }], ...extra });

    it('diaria 11:00: antes de la hora no envía; desde la hora sí, y una reserva que llega después de la hora recibe ese mismo día', async () => {
      await diaria(11);
      const a = await ingestar(reserva(-4, -1)); // check-out ayer
      jest.setSystemTime(CDMX(10));
      await barrido.ejecutarBarrido();
      expect(enviar).not.toHaveBeenCalled();

      jest.setSystemTime(CDMX(11));
      await barrido.ejecutarBarrido();
      expect(enviadas()).toEqual([a.ordenId]);

      const b = await ingestar(reserva(-3, -1)); // llega a Aelika a las 15:00, después de la hora
      jest.setSystemTime(CDMX(15));
      await barrido.ejecutarBarrido();
      expect(enviadas()).toEqual([a.ordenId, b.ordenId]);

      jest.setSystemTime(CDMX(23));
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(2);
    });

    it('cambio de día en CDMX: a las 23:59 aún es "hoy"; a las 00:00 ya es el día siguiente (y antes de la hora no se evalúa)', async () => {
      await diaria(11);
      await ingestar(reserva(-4, -1)); // check-out el 29: "1 día" el 30, "2 días" el 1
      jest.setSystemTime(new Date('2026-10-01T05:59:00.000Z')); // 23:59 del 30 en CDMX
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(1);
    });

    it('al día siguiente la reserva ya no cumple "1 día desde el check-out" y nunca se manda tarde', async () => {
      await diaria(11);
      await ingestar(reserva(-4, -1));
      jest.setSystemTime(new Date('2026-10-01T17:00:00.000Z')); // 11:00 del 1 de octubre CDMX
      await barrido.ejecutarBarrido();
      expect(enviar).not.toHaveBeenCalled();
    });

    it('diaria a las 0: se evalúa todo el día; cada hora: en cualquier hora', async () => {
      await diaria(0);
      await ingestar(reserva(-4, -1));
      jest.setSystemTime(CDMX(0));
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(1);
    });

    it('hora de CDMX aunque el servidor esté en UTC: 16:59Z son las 10:59 CDMX (antes de las 11)', async () => {
      await diaria(11);
      await ingestar(reserva(-4, -1));
      jest.setSystemTime(new Date(`${HOY}T16:59:00.000Z`));
      await barrido.ejecutarBarrido();
      expect(enviar).not.toHaveBeenCalled();
      jest.setSystemTime(new Date(`${HOY}T17:00:00.000Z`));
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(1);
    });
  });

  describe('condiciones de días e idioma', () => {
    const casos: [string, string, number, number[]][] = [
      ['DIAS_PARA_CHECKIN', 'IGUAL', 2, [2]],
      ['DIAS_PARA_CHECKIN', 'MAYOR_IGUAL', 1, [1, 2, 5]],
      ['DIAS_PARA_CHECKIN', 'MENOR_IGUAL', 0, [-2, -1, 0]],
      ['DIAS_DESDE_CHECKOUT', 'IGUAL', 1, [-1]],
      ['DIAS_DESDE_CHECKOUT', 'MAYOR_IGUAL', 1, [-2, -1]],
      ['DIAS_DESDE_CHECKOUT', 'MENOR_IGUAL', 0, [0, 1, 2, 5]],
    ];
    it.each(casos)('%s %s %i: días de calendario en CDMX', async (campo, operador, valor, esperados) => {
      // check-out = offset (para DESDE_CHECKOUT) o check-in = offset (para PARA_CHECKIN)
      const offsets = [-2, -1, 0, 1, 2, 5];
      const ids: Record<number, string> = {};
      for (const o of offsets) {
        const r = campo === 'DIAS_PARA_CHECKIN' ? reserva(o, o + 1) : reserva(o - 3, o);
        ids[o] = (await ingestar(r)).ordenId;
      }
      await crearRegla({ filtro: [{ campo, operador, valor }] });
      await barrido.ejecutarBarrido();
      expect(enviadas().sort()).toEqual(esperados.map((o) => ids[o]).sort());
    });

    it('dos reglas complementarias por idioma: cada reserva recibe solo una (sin idioma = ES; DE = no ES)', async () => {
      const es = await crearRegla({ nombre: 'ES', filtro: [CHECKIN_FUTURO, FILTRO_ES] });
      const en = await crearRegla({ nombre: 'EN', filtro: [CHECKIN_FUTURO, FILTRO_NO_ES], plantillaIdioma: 'en' });
      const rES = await ingestar(reserva(3, 4, { idioma: 'ES' }));
      const rEN = await ingestar(reserva(3, 4, { idioma: 'EN' }));
      const rDE = await ingestar(reserva(3, 4, { idioma: 'DE' }));
      const rSin = await ingestar(reserva(3, 4, { idioma: '' }));
      await barrido.ejecutarBarrido();
      const porRegla = (id: string) => enviar.mock.calls.filter((c) => c[2].id === id).map((c) => c[4]).sort();
      expect(porRegla(es.id)).toEqual([rES.ordenId, rSin.ordenId].sort());
      expect(porRegla(en.id)).toEqual([rEN.ordenId, rDE.ordenId].sort());
      expect(enviar).toHaveBeenCalledTimes(4);
    });
  });

  it('solo reservas de ESE negocio y solo en negocios Hotel', async () => {
    await crearRegla();
    await ingestar(reserva(3, 5));
    const otro = await seedBase(s.h.prisma, { slug: 'otro-hotel', tipoStorefront: 'HOTEL' });
    await s.h.prisma.tenant.update({ where: { id: otro.tenant.id }, data: { botWebhookUrl: 'http://localhost:9/hook' } });
    await request(s.h.app.getHttpServer()).post('/internal/reservas/amenitiz').set('X-Api-Key', `key-otro-hotel`).send(reserva(3, 5));
    await barrido.ejecutarBarrido();
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls[0][0].id).toBe(s.base.tenant.id);
  });

  describe('API de reglas', () => {
    const dueno = () => apiRol(s.h, s.base, 'DUENO');
    const body = (extra: Record<string, unknown> = {}) => ({
      nombre: 'Reserva confirmada',
      trigger: 'RESERVA_AUTOMATICA',
      triggerConfig: { frecuencia: 'DIARIA', hora: 11 },
      filtro: [{ campo: 'DIAS_DESDE_CHECKOUT', operador: 'IGUAL', valor: 1 }, FILTRO_ES],
      plantillaNombre: 'califica',
      plantillaIdioma: 'es',
      plantillaCategoria: 'UTILITY',
      ...extra,
    });
    it('un hotel la crea; la respuesta no expone campos internos', async () => {
      const res = await dueno().post('/reglas', body());
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ trigger: 'RESERVA_AUTOMATICA', triggerConfig: { frecuencia: 'DIARIA', hora: 11 } });
      expect(res.body).not.toHaveProperty('estadoBasePendiente');
    });
    it('rechaza configuración y filtros inválidos', async () => {
      for (const extra of [
        { triggerConfig: { frecuencia: 'DIARIA' } },
        { triggerConfig: { frecuencia: 'DIARIA', hora: 24 } },
        { triggerConfig: { frecuencia: 'CADA_HORA', hora: 5 } },
        { triggerConfig: { frecuencia: 'SEMANAL' } },
        { filtro: [] },
        { filtro: [FILTRO_ES] }, // sin condición de días
        { filtro: [{ campo: 'DIAS_PARA_CHECKIN', operador: 'ES', valor: 1 }] },
        { filtro: [{ campo: 'TOTAL_PEDIDOS', operador: 'MAYOR_IGUAL', valor: 1 }] },
        { filtro: [{ campo: 'IDIOMA_HUESPED', operador: 'ES', valor: 'FR' }, CHECKIN_FUTURO] },
      ]) {
        expect([JSON.stringify(extra), (await dueno().post('/reglas', body(extra))).status]).toEqual([JSON.stringify(extra), 400]);
      }
    });
    it('no está disponible para negocios que no son Hotel', async () => {
      const cafe = await seedBase(s.h.prisma, { slug: 'cafe-no-hotel', tipoStorefront: 'RETAIL_B2C' });
      const res = await apiRol(s.h, cafe, 'DUENO').post('/reglas', body());
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Hotel/);
    });
    it('variables: las de reserva solo en este trigger y las de pedido B2C/B2B se rechazan aquí', async () => {
      const vars = (fuente: string, valor: string) => [{ posicion: 1, fuente, valor }];
      expect((await dueno().post('/reglas', body({ plantillaVariables: vars('CAMPO_RESERVA', 'checkIn') }))).status).toBe(201);
      expect((await dueno().post('/reglas', body({ plantillaVariables: vars('CAMPO_PEDIDO', 'folio') }))).status).toBe(400);
      expect((await dueno().post('/reglas', body({ plantillaVariables: vars('CAMPO_CLIENTE', 'primerNombre') }))).status).toBe(201);
      const manual = { trigger: 'MANUAL', triggerConfig: undefined, filtro: [], plantillaVariables: vars('CAMPO_RESERVA', 'checkIn') };
      expect((await dueno().post('/reglas', body(manual))).status).toBe(400);
    });
    it('el catálogo de variables incluye las de reserva', async () => {
      const cat = (await dueno().get('/reglas/catalogo-variables')).body as { fuente: string; valor: string }[];
      expect(cat.filter((v) => v.fuente === 'CAMPO_RESERVA').map((v) => v.valor).sort()).toEqual(
        ['adultos', 'checkIn', 'checkOut', 'enlaceCheckin', 'habitaciones', 'huespedes', 'ninos', 'noches', 'numeroReserva'].sort(),
      );
    });
  });

  describe('envío real a Botpress (ReglaEnvioService)', () => {
    const fetchOriginal = global.fetch;
    afterEach(() => {
      global.fetch = fetchOriginal;
      jest.restoreAllMocks();
    });
    const envioReal = () => new ReglaEnvioService(s.h.prisma, { get: () => 'http://localhost:3000/tienda' } as any);
    const VARS = [
      { posicion: 1, fuente: 'CAMPO_RESERVA', valor: 'numeroReserva' },
      { posicion: 2, fuente: 'CAMPO_RESERVA', valor: 'checkIn' },
      { posicion: 3, fuente: 'CAMPO_RESERVA', valor: 'checkOut' },
      { posicion: 4, fuente: 'CAMPO_RESERVA', valor: 'noches' },
      { posicion: 5, fuente: 'CAMPO_RESERVA', valor: 'adultos' },
      { posicion: 6, fuente: 'CAMPO_RESERVA', valor: 'ninos' },
      { posicion: 7, fuente: 'CAMPO_RESERVA', valor: 'huespedes' },
      { posicion: 8, fuente: 'CAMPO_RESERVA', valor: 'habitaciones' },
      { posicion: 9, fuente: 'CAMPO_RESERVA', valor: 'enlaceCheckin' },
      { posicion: 10, fuente: 'CAMPO_CLIENTE', valor: 'primerNombre' },
    ];
    const contexto = (b: any) => ({
      origen: 'RESERVA' as const,
      folio: String(b.booking_id),
      total: '100',
      estatus: '',
      createdAt: new Date(),
      items: [],
      checkIn: new Date('2026-12-25T00:00:00.000Z'),
      checkOut: new Date('2026-12-29T00:00:00.000Z'),
      adultos: 2,
      ninos: 1,
      habitaciones: 'Superior #5, Estándar #15',
      enlaceCheckin: b.online_checkin_url,
    });
    const preparar = async (idiomaPlantilla: string) => {
      const b = reserva(3, 5);
      await ingestar(b);
      const tenant = await s.h.prisma.tenant.findUniqueOrThrow({ where: { id: s.base.tenant.id } });
      const cliente = await s.h.prisma.cliente.findFirstOrThrow();
      const regla = await crearRegla({ plantillaIdioma: idiomaPlantilla, plantillaVariables: VARS });
      return { b, tenant, cliente, regla };
    };

    it('variables de reserva con fechas en el idioma de la plantilla (es / en); el enlace de check-in no aparece en ningún log', async () => {
      const cuerpos: any[] = [];
      global.fetch = jest.fn(async (_u: any, init: any) => {
        cuerpos.push(JSON.parse(init.body));
        return { ok: true } as Response;
      }) as any;
      const espiados = [jest.spyOn(Logger.prototype, 'log'), jest.spyOn(Logger.prototype, 'warn'), jest.spyOn(Logger.prototype, 'error')];

      const es = await preparar('es');
      const orden = await s.h.prisma.order.findFirstOrThrow({ where: { tipo: 'RESERVA' } });
      await envioReal().enviar(es.tenant, es.cliente, es.regla, contexto(es.b), orden.id);
      const reglaEn = await crearRegla({ plantillaIdioma: 'en_US', plantillaVariables: VARS });
      await envioReal().enviar(es.tenant, es.cliente, reglaEn, contexto(es.b), orden.id);

      const [vEs, vEn] = [cuerpos[cuerpos.length - 2].variables, cuerpos[cuerpos.length - 1].variables];
      expect(vEs.slice(0, 9)).toEqual([String(es.b.booking_id), '25 de diciembre de 2026', '29 de diciembre de 2026', '4', '2', '1', '3', 'Superior #5, Estándar #15', es.b.online_checkin_url]);
      expect(vEn[1]).toBe('December 25, 2026');
      expect(vEn[2]).toBe('December 29, 2026');
      expect(vEs[9]).toBe('Huesped');
      const impreso = espiados.flatMap((e) => e.mock.calls).map((c) => String(c[0])).join('\n');
      expect(impreso).not.toContain('online-check-in');
      expect(impreso).not.toContain('token-secreto');
    });

    it('una variable de pedido B2C/B2B fuera de contexto se rechaza al enviar una reserva', async () => {
      global.fetch = jest.fn() as any;
      const { b, tenant, cliente } = await preparar('es');
      const mala = await crearRegla({ nombre: 'mala', plantillaVariables: [{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'folio' }] });
      await expect(envioReal().enviar(tenant, cliente, mala, contexto(b))).rejects.toThrow(/no aplica a este envío/);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('tiempo límite: el POST lleva una señal de 10 s y un vencimiento deja el envío en FALLO', async () => {
      expect(TIMEOUT_ENVIO_MS).toBe(10_000);
      let senal: AbortSignal | undefined;
      global.fetch = jest.fn(async (_u: any, init: any) => {
        senal = init.signal;
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }) as any;
      const { b, tenant, cliente, regla } = await preparar('es');
      const orden = await s.h.prisma.order.findFirstOrThrow({ where: { tipo: 'RESERVA' } });
      const log = await envioReal().enviar(tenant, cliente, regla, contexto(b), orden.id);
      expect(senal).toBeInstanceOf(AbortSignal);
      expect(log.estado).toBe('FALLO');
      expect(log.orderId).toBe(orden.id);
    });
  });
});
