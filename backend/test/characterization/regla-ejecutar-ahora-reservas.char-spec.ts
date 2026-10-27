import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import request from 'supertest';
import { ReglaBarridoService } from '../../src/notificaciones-reglas/regla-barrido.service';
import { ReglaCandadoService } from '../../src/notificaciones-reglas/regla-candado.service';
import { ReglasFiltroService } from '../../src/notificaciones-reglas/reglas-filtro.service';
import { seedBase } from './db';
import { apiRol } from './b2b-helpers';
import { usarSuite } from './helpers';

const HOY = '2026-09-30'; // AHORA de la suite = 10:00 CDMX
const DIA_MS = 24 * 60 * 60 * 1000;
const ymd = (offset: number) => new Date(new Date(`${HOY}T00:00:00.000Z`).getTime() + offset * DIA_MS).toISOString().slice(0, 10);
const CDMX = (hora: number) => new Date(new Date(`${HOY}T${String(hora).padStart(2, '0')}:00:00.000Z`).getTime() + 6 * 60 * 60 * 1000);

let seq = 0;
const reserva = (checkInOffset: number, checkOutOffset: number, extra: { idioma?: string; status?: string } = {}) => {
  seq += 1;
  return {
    booking_id: 8000000000 + seq,
    status: extra.status ?? 'confirmed',
    currency_code: 'USD',
    source: 'booking.com',
    total_amount_after_tax: '100.00',
    checkin: ymd(checkInOffset),
    checkout: ymd(checkOutOffset),
    adults: 2,
    children: 0,
    online_checkin_url: `https://hotel.amenitiz.io/booking/token-secreto-${seq}/online-check-in`,
    booker: { first_name: 'Huesped', last_name: String(seq), email: '', phone: `+1 818 555 ${String(2000 + seq)}`, language: extra.idioma ?? 'ES' },
    rooms: [{ individual_room_name: 'Superior', individual_room_number: seq }],
  };
};

describe('Reglas RESERVA_AUTOMATICA · «Ejecutar ahora»', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'HOTEL' } });
  let estadoEnvio: 'EXITO' | 'FALLO' | 'EN_CURSO' = 'EXITO';
  let barrido: ReglaBarridoService;
  const enviar = jest.fn();

  const ingestar = async (b: object) => {
    const res = await request(s.h.app.getHttpServer()).post('/internal/reservas/amenitiz').set('X-Api-Key', `key-${s.base.tenant.slug}`).send(b);
    expect(res.status).toBe(200);
    return res.body as { ordenId: string };
  };
  const crearRegla = (extra: Record<string, unknown> = {}, tenantId = s.base.tenant.id) =>
    s.h.prisma.regla.create({
      data: {
        tenantId,
        nombre: 'Reserva',
        trigger: 'RESERVA_AUTOMATICA',
        triggerConfig: { frecuencia: 'CADA_HORA' },
        filtro: [
          { campo: 'DIAS_PARA_CHECKIN', operador: 'MAYOR_IGUAL', valor: 0 },
          { campo: 'IDIOMA_HUESPED', operador: 'ES', valor: 'ES' },
        ],
        canal: 'WHATSAPP',
        plantillaNombre: 'reserva_confirmada',
        plantillaIdioma: 'es_MX',
        plantillaCategoria: 'UTILITY',
        plantillaVariables: [],
        activa: true,
        ...extra,
      } as any,
    });
  const enviadas = () => enviar.mock.calls.map((c) => c[4] as string);
  const ejecutar = (reglaId: string) => barrido.ejecutarReservaAhora(reglaId, s.base.tenant.id);

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

  it('envía lo mismo que el barrido (filtro de días, idioma, solo no canceladas) y resume la ejecución', async () => {
    const regla = await crearRegla();
    const a = await ingestar(reserva(3, 5)); // cumple
    await ingestar(reserva(3, 5, { idioma: 'DE' })); // otro idioma
    await ingestar(reserva(-4, -2)); // check-in ya pasó
    await ingestar(reserva(3, 5, { status: 'cancelled' })); // cancelada

    const resumen = await ejecutar(regla.id);
    expect(resumen).toEqual({ reservasEvaluadas: 1, enviadas: 1, omitidasYaEnviadas: 0, fallidas: 0, bloqueadasPorCandado: 0, fueraDeVentana: false });
    expect(enviadas()).toEqual([a.ordenId]);

    // El barrido horario, después, no encuentra nada más que enviar: la ejecución manual y el barrido coinciden.
    await barrido.ejecutarBarrido();
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('ejecutarla dos veces seguidas no reenvía nada', async () => {
    const regla = await crearRegla();
    await ingestar(reserva(3, 5));
    await ingestar(reserva(4, 6));
    const primera = await ejecutar(regla.id);
    expect(primera).toMatchObject({ reservasEvaluadas: 2, enviadas: 2, omitidasYaEnviadas: 0 });

    const segunda = await ejecutar(regla.id);
    expect(segunda).toEqual({ reservasEvaluadas: 2, enviadas: 0, omitidasYaEnviadas: 2, fallidas: 0, bloqueadasPorCandado: 0, fueraDeVentana: false });
    expect(enviar).toHaveBeenCalledTimes(2);
  });

  it('lo que el barrido ya envió se omite; una reserva nueva sí se envía', async () => {
    const regla = await crearRegla();
    await ingestar(reserva(3, 5));
    await barrido.ejecutarBarrido();
    const nueva = await ingestar(reserva(4, 6));

    const resumen = await ejecutar(regla.id);
    expect(resumen).toMatchObject({ reservasEvaluadas: 2, enviadas: 1, omitidasYaEnviadas: 1 });
    expect(enviadas()[1]).toBe(nueva.ordenId);
  });

  it('un envío que Botpress rechaza (FALLO) cuenta como fallido y es definitivo: no se reintenta', async () => {
    const regla = await crearRegla();
    await ingestar(reserva(3, 5));
    estadoEnvio = 'FALLO';
    const primera = await ejecutar(regla.id);
    expect(primera).toMatchObject({ reservasEvaluadas: 1, enviadas: 0, fallidas: 1, omitidasYaEnviadas: 0 });

    estadoEnvio = 'EXITO';
    const segunda = await ejecutar(regla.id);
    expect(segunda).toMatchObject({ enviadas: 0, fallidas: 0, omitidasYaEnviadas: 1 });
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('un envío que ni puede intentarse cuenta como fallido, no deja registro y se reintenta en la siguiente ejecución', async () => {
    const regla = await crearRegla();
    const a = await ingestar(reserva(3, 5));
    enviar.mockReset().mockRejectedValueOnce(new Error('sin webhook'));
    const primera = await ejecutar(regla.id);
    expect(primera).toMatchObject({ reservasEvaluadas: 1, enviadas: 0, fallidas: 1 });
    expect(await s.h.prisma.reglaEnvioLog.count()).toBe(0);

    enviar.mockImplementation(async (tenant, cliente, r, _c, orderId) =>
      s.h.prisma.reglaEnvioLog.create({ data: { tenantId: tenant.id, clienteId: cliente.id, reglaId: r.id, categoria: r.plantillaCategoria, estado: 'EXITO', orderId } }),
    );
    const segunda = await ejecutar(regla.id);
    expect(segunda).toMatchObject({ enviadas: 1, fallidas: 0 });
    expect(enviadas()).toEqual([a.ordenId, a.ordenId]); // el intento fallido y el reintento, ambos a la misma reserva
  });

  it('regla diaria antes de su hora: no evalúa ni envía nada; desde su hora sí', async () => {
    const regla = await crearRegla({ triggerConfig: { frecuencia: 'DIARIA', hora: 11 }, filtro: [{ campo: 'DIAS_DESDE_CHECKOUT', operador: 'IGUAL', valor: 1 }] });
    const a = await ingestar(reserva(-4, -1)); // check-out ayer

    jest.setSystemTime(CDMX(10));
    expect(await ejecutar(regla.id)).toEqual({ reservasEvaluadas: 0, enviadas: 0, omitidasYaEnviadas: 0, fallidas: 0, bloqueadasPorCandado: 0, fueraDeVentana: true });
    expect(enviar).not.toHaveBeenCalled();

    jest.setSystemTime(CDMX(11));
    expect(await ejecutar(regla.id)).toMatchObject({ reservasEvaluadas: 1, enviadas: 1, fueraDeVentana: false });
    expect(enviadas()).toEqual([a.ordenId]);
  });

  it('con el candado de Marketing: la bloqueada se reporta, no deja registro y sigue pendiente', async () => {
    const regla = await crearRegla({ plantillaCategoria: 'MARKETING' });
    await ingestar(reserva(3, 5));
    const cliente = await s.h.prisma.cliente.findFirstOrThrow();
    await s.h.prisma.reglaEnvioLog.create({ data: { tenantId: s.base.tenant.id, clienteId: cliente.id, categoria: 'MARKETING', estado: 'EXITO' } });

    const resumen = await ejecutar(regla.id);
    expect(resumen).toMatchObject({ reservasEvaluadas: 1, enviadas: 0, bloqueadasPorCandado: 1, fallidas: 0, omitidasYaEnviadas: 0 });
    expect(enviar).not.toHaveBeenCalled();
  });

  it('dos ejecuciones simultáneas de la misma regla: la segunda recibe 409 y no se duplica nada', async () => {
    const regla = await crearRegla();
    await ingestar(reserva(3, 5));
    let liberar!: () => void;
    const espera = new Promise<void>((r) => (liberar = r));
    enviar.mockReset().mockImplementation(async (tenant, cliente, r, _c, orderId) => {
      await espera;
      return s.h.prisma.reglaEnvioLog.create({ data: { tenantId: tenant.id, clienteId: cliente.id, reglaId: r.id, categoria: r.plantillaCategoria, estado: 'EXITO', orderId } });
    });
    const primera = ejecutar(regla.id);
    await new Promise((r) => setImmediate(r));
    await expect(ejecutar(regla.id)).rejects.toBeInstanceOf(ConflictException);
    liberar();
    expect(await primera).toMatchObject({ enviadas: 1 });
    expect(enviar).toHaveBeenCalledTimes(1);
    // Terminada la primera, la regla vuelve a poder ejecutarse.
    expect(await ejecutar(regla.id)).toMatchObject({ enviadas: 0, omitidasYaEnviadas: 1 });
  });

  describe('rechazos', () => {
    it('regla inactiva → 400', async () => {
      const regla = await crearRegla({ activa: false });
      await expect(ejecutar(regla.id)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('regla de otro tipo (MANUAL) → 400', async () => {
      const regla = await crearRegla({ trigger: 'MANUAL', triggerConfig: undefined, filtro: [] });
      await expect(ejecutar(regla.id)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('regla inexistente o de otro negocio → 404', async () => {
      await expect(ejecutar('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundException);
      const otro = await seedBase(s.h.prisma, { slug: 'otro-hotel', tipoStorefront: 'HOTEL' });
      const ajena = await crearRegla({}, otro.tenant.id);
      await expect(ejecutar(ajena.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('negocio que no es Hotel → 400', async () => {
      const otro = await seedBase(s.h.prisma, { slug: 'tienda', tipoStorefront: 'RETAIL_B2C' });
      const regla = await crearRegla({}, otro.tenant.id);
      await expect(barrido.ejecutarReservaAhora(regla.id, otro.tenant.id)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('API POST /reglas/:id/ejecutar-ahora', () => {
    // El harness sustituye ReglaBarridoService por un objeto vacío; aquí se le conecta el método real (con el envío falso).
    let stub: any;
    beforeEach(() => {
      stub = s.h.app.get(ReglaBarridoService);
      stub.ejecutarReservaAhora = (id: string, tenantId: string) => barrido.ejecutarReservaAhora(id, tenantId);
    });
    afterEach(() => {
      delete stub.ejecutarReservaAhora;
    });

    it('el Dueño la ejecuta y recibe el resumen', async () => {
      const regla = await crearRegla();
      await ingestar(reserva(3, 5));
      const res = await apiRol(s.h, s.base, 'DUENO').post(`/reglas/${regla.id}/ejecutar-ahora`);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ reservasEvaluadas: 1, enviadas: 1, omitidasYaEnviadas: 0, fallidas: 0, bloqueadasPorCandado: 0, fueraDeVentana: false });
      const otra = await apiRol(s.h, s.base, 'DUENO').post(`/reglas/${regla.id}/ejecutar-ahora`);
      expect(otra.body).toMatchObject({ enviadas: 0, omitidasYaEnviadas: 1 });
    });

    it.each(['OPERADOR', 'GERENTE'] as const)('%s recibe 403 y no se envía nada', async (rol) => {
      const regla = await crearRegla();
      await ingestar(reserva(3, 5));
      const res = await apiRol(s.h, s.base, rol).post(`/reglas/${regla.id}/ejecutar-ahora`);
      expect(res.status).toBe(403);
      expect(enviar).not.toHaveBeenCalled();
    });

    it('sin sesión → 401', async () => {
      const regla = await crearRegla();
      const res = await request(s.h.app.getHttpServer()).post(`/reglas/${regla.id}/ejecutar-ahora`);
      expect(res.status).toBe(401);
    });
  });
});
