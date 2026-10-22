import request from 'supertest';
import { apiRol } from './b2b-helpers';
import { bodyCheckout, usarSuite } from './helpers';
import { ReglaEnvioService } from '../../src/notificaciones-reglas/regla-envio.service';

// Hotel · ingesta de reservas de Amenitiz (POST /internal/reservas/amenitiz). Fixtures = respuestas reales de
// `bookings/updated` (nombres/dígitos alterados).
const BOOKING_MX = {
  booking_id: 9641816459,
  status: 'confirmed',
  currency_code: 'USD',
  source: 'booking.com',
  total_amount_after_tax: '1352.54',
  checkin: '2026-10-11',
  checkout: '2026-10-12',
  adults: 2,
  children: 2,
  online_checkin_url: 'https://villas-ajijic.amenitiz.io/booking/ca8facf0/online-check-in',
  online_checkin_registered: false,
  campo_nuevo_de_amenitiz: { x: 1 },
  booker: { first_name: 'Zaida', last_name: 'Torres', email: 'ztorre.100335@guest.booking.com', phone: '+52 33 1485 0000', language: 'ES' },
  rooms: [{ room_id: '4957f59b', individual_room_id: 'bf22b179', individual_room_name: 'Estándar - 2 cama', individual_room_number: 7, adults: 2, children: 2, guests: [{ first_name: 'Zaida', last_name: 'Torres' }] }],
};
const MANUAL_SIN_TEL = {
  booking_id: 819461410,
  status: 'confirmed',
  currency_code: 'USD',
  source: 'manual',
  total_amount_after_tax: '1200.0',
  checkin: '2026-10-08',
  checkout: '2026-10-09',
  adults: 1,
  children: 0,
  online_checkin_url: 'https://villas-ajijic.amenitiz.io/booking/1276a7b6/online-check-in',
  booker: { first_name: 'cesar', last_name: 'olivia', email: '', phone: '', language: 'ES' },
  rooms: [{ individual_room_name: 'Estándar - 2 cama', individual_room_number: 4, adults: 1, children: 0 }],
};
const EXPEDIA_CANCELADA = {
  booking_id: 999133629,
  status: 'cancelled',
  currency_code: 'USD',
  source: 'A-Expedia Affiliate Network',
  total_amount_after_tax: '2449.04',
  checkin: '2026-11-04',
  checkout: '2026-11-06',
  adults: 2,
  children: 0,
  booker: { first_name: 'Magdalena', last_name: 'Ojeda', email: '0fytucgjl2@m.expediapartnercentral.com', phone: '+11 1111111111', language: 'ES' },
  rooms: [{ individual_room_name: 'Habitación Doble Deluxe', individual_room_number: 3, adults: 2, children: 0 }],
};
const MODIFICADA_US = {
  booking_id: 2867104687,
  status: 'modified',
  currency_code: 'USD',
  source: 'booking.com',
  total_amount_after_tax: '7213.55',
  checkin: '2026-12-25',
  checkout: '2026-12-29',
  adults: 2,
  children: 0,
  online_checkin_url: 'https://villas-ajijic.amenitiz.io/booking/c28fbb0e/online-check-in',
  booker: { first_name: 'Martin', last_name: 'Vazquez', email: 'mvazqu.298205@guest.booking.com', phone: '+1 818 814 0000', language: 'EN' },
  rooms: [
    { individual_room_name: 'Habitación Superior', individual_room_number: 5, adults: 1, children: 0 },
    { individual_room_name: 'Estándar', individual_room_number: 15, adults: 1, children: 0 },
  ],
};

describe('Hotel · ingesta de reservas de Amenitiz', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'HOTEL' } });
  const llave = () => `key-${s.base.tenant.slug}`;
  const enviar = (body: unknown, key: string | null = llave()) => {
    const r = request(s.h.app.getHttpServer()).post('/internal/reservas/amenitiz');
    if (key) r.set('X-Api-Key', key);
    return r.send(body as object);
  };
  const ordenes = () => s.h.prisma.order.findMany({ where: { tipo: 'RESERVA' }, include: { detalleReserva: true, items: true } });
  const cliente = (telefono: string) => s.h.prisma.cliente.findFirstOrThrow({ where: { telefono } });
  const sinEfectos = () => {
    expect(s.h.fakes.queueAdd).not.toHaveBeenCalled();
    expect(s.h.fakes.reglaEnvio).not.toHaveBeenCalled();
    expect(s.h.fakes.paymentIntentsCreate).not.toHaveBeenCalled();
  };

  describe('crear', () => {
    it('Booking con teléfono mexicano: crea orden RESERVA + detalle + cliente, sin ítems ni efectos', async () => {
      const res = await enviar(BOOKING_MX);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ resultado: 'creada', ordenId: expect.any(String), folio: '9641816459', cancelada: false });

      const [o] = await ordenes();
      expect(o).toMatchObject({
        tipo: 'RESERVA',
        folio: '9641816459',
        clienteNombre: 'Zaida Torres',
        clienteTelefono: '3314850000',
        clienteCorreo: 'ztorre.100335@guest.booking.com',
        metodoPago: 'EXTERNO',
        estadoPago: 'PENDIENTE',
        cancelado: false,
        canceladoAt: null,
      });
      expect(Number(o.total)).toBe(1352.54);
      expect(o.items).toHaveLength(0);
      expect(o.detalleReserva).toMatchObject({
        pmsProveedor: 'AMENITIZ',
        pmsReservaId: '9641816459',
        adultos: 2,
        ninos: 2,
        habitaciones: 'Estándar - 2 cama #7',
        origen: 'booking.com',
        moneda: 'USD',
        idiomaHuesped: 'ES',
        onlineCheckinUrl: BOOKING_MX.online_checkin_url,
      });
      expect(o.detalleReserva!.checkIn.toISOString().slice(0, 10)).toBe('2026-10-11');
      expect(o.detalleReserva!.checkOut.toISOString().slice(0, 10)).toBe('2026-10-12');
      const c = await cliente('3314850000');
      expect(c).toMatchObject({ canal: 'B2C', nombre: 'Zaida Torres', totalPedidos: 1 });
      expect(o.clienteId).toBe(c.id);
      sinEfectos();
    });

    it('internacional (+1) con dos habitaciones: teléfono completo con "+", sin truncar', async () => {
      const res = await enviar(MODIFICADA_US); // "modified" de una reserva que Aelika nunca vio → se crea
      expect(res.body.resultado).toBe('creada');
      const [o] = await ordenes();
      expect(o.clienteTelefono).toBe('+18188140000');
      expect(o.detalleReserva!.habitaciones).toBe('Habitación Superior #5, Estándar #15');
      expect(o.detalleReserva!.idiomaHuesped).toBe('EN');
      expect((await cliente('+18188140000')).totalPedidos).toBe(1);
      expect(await s.h.prisma.cliente.count({ where: { telefono: '8188140000' } })).toBe(0);
    });

    it('manual sin teléfono: 200 omitida_sin_telefono y no se guarda nada (ni orden ni cliente)', async () => {
      const res = await enviar(MANUAL_SIN_TEL);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ resultado: 'omitida_sin_telefono', ordenId: null, folio: null, cancelada: null });
      expect(await ordenes()).toHaveLength(0);
      expect(await s.h.prisma.cliente.count()).toBe(0);
    });

    it('placeholder de Expedia ("+11 1111111111") también es sin teléfono; con teléfono real llega cancelada y se crea sin contar', async () => {
      expect((await enviar(EXPEDIA_CANCELADA)).body.resultado).toBe('omitida_sin_telefono');
      const res = await enviar({ ...EXPEDIA_CANCELADA, booker: { ...EXPEDIA_CANCELADA.booker, phone: '+34 612 345 678' } });
      expect(res.body).toMatchObject({ resultado: 'creada', cancelada: true });
      const [o] = await ordenes();
      expect(o.cancelado).toBe(true);
      expect(o.canceladoAt).not.toBeNull();
      expect((await cliente('+34612345678')).totalPedidos).toBe(0);
    });

    it('sin nombre usa "Huésped"; correo vacío no se guarda', async () => {
      await enviar({ ...BOOKING_MX, booker: { first_name: '', last_name: '', email: '', phone: '+52 33 1485 0000' } });
      const [o] = await ordenes();
      expect(o).toMatchObject({ clienteNombre: 'Huésped', clienteCorreo: null });
    });

    it('total faltante = 0; el folio conserva un booking_id de 10 dígitos (mayor a un entero de 32 bits)', async () => {
      const { total_amount_after_tax: _t, ...sinTotal } = BOOKING_MX;
      await enviar({ ...sinTotal, booking_id: '2867104687' });
      const [o] = await ordenes();
      expect(Number(o.total)).toBe(0);
      expect(o.folio).toBe('2867104687');
    });
  });

  describe('repetir, actualizar, cancelar', () => {
    it('repetir sin cambios: sin_cambios y la orden no se toca', async () => {
      const primera = await enviar(BOOKING_MX);
      const antes = (await ordenes())[0];
      jest.setSystemTime(new Date(Date.now() + 60_000));
      const res = await enviar({ ...BOOKING_MX, total_amount_after_tax: '1352.540' });
      expect(res.body).toEqual({ resultado: 'sin_cambios', ordenId: primera.body.ordenId, folio: '9641816459', cancelada: false });
      const despues = (await ordenes())[0];
      expect(despues.updatedAt.getTime()).toBe(antes.updatedAt.getTime());
      expect(await ordenes()).toHaveLength(1);
      expect(await s.h.prisma.cliente.count()).toBe(1);
    });

    it('cambian fechas, huéspedes, habitación, total, origen y contacto (mismo teléfono): actualizada', async () => {
      await enviar(BOOKING_MX);
      const res = await enviar({
        ...BOOKING_MX,
        status: 'modified',
        checkin: '2026-10-12',
        checkout: '2026-10-15',
        adults: 1,
        children: 0,
        source: 'amenitiz',
        total_amount_after_tax: '2000.00',
        booker: { ...BOOKING_MX.booker, first_name: 'Zaida Maria' },
        rooms: [{ individual_room_name: 'Suite', individual_room_number: 9 }],
      });
      expect(res.body.resultado).toBe('actualizada');
      const [o] = await ordenes();
      expect(o).toMatchObject({ clienteNombre: 'Zaida Maria Torres' });
      expect(Number(o.total)).toBe(2000);
      expect(o.detalleReserva).toMatchObject({ adultos: 1, ninos: 0, origen: 'amenitiz', habitaciones: 'Suite #9' });
      expect(o.detalleReserva!.checkIn.toISOString().slice(0, 10)).toBe('2026-10-12');
      expect((await cliente('3314850000')).nombre).toBe('Zaida Maria Torres');
    });

    it('cancelar descuenta del cliente; repetir la cancelación no hace nada; confirmada de nuevo la reactiva', async () => {
      await enviar(BOOKING_MX);
      expect((await cliente('3314850000')).totalPedidos).toBe(1);

      const cancel = await enviar({ ...BOOKING_MX, status: 'cancelled' });
      expect(cancel.body).toMatchObject({ resultado: 'cancelada', cancelada: true });
      const [o] = await ordenes();
      expect(o.cancelado).toBe(true);
      expect(o.canceladoAt).not.toBeNull();
      expect((await cliente('3314850000')).totalPedidos).toBe(0);

      expect((await enviar({ ...BOOKING_MX, status: 'cancelled' })).body.resultado).toBe('sin_cambios');

      const react = await enviar({ ...BOOKING_MX, status: 'confirmed' });
      expect(react.body).toMatchObject({ resultado: 'reactivada', cancelada: false });
      const [o2] = await ordenes();
      expect(o2).toMatchObject({ cancelado: false, canceladoAt: null });
      expect((await cliente('3314850000')).totalPedidos).toBe(1);
    });

    it('existente que llega sin teléfono utilizable: aplica el cambio y conserva el contacto guardado', async () => {
      await enviar(BOOKING_MX);
      const res = await enviar({ ...BOOKING_MX, status: 'cancelled', booker: { first_name: '', last_name: '', email: '', phone: '' } });
      expect(res.body.resultado).toBe('cancelada');
      const [o] = await ordenes();
      expect(o).toMatchObject({ clienteNombre: 'Zaida Torres', clienteTelefono: '3314850000', clienteCorreo: 'ztorre.100335@guest.booking.com' });
    });

    it('cambio de teléfono re-liga al otro cliente y recalcula ambos', async () => {
      await enviar(BOOKING_MX);
      const antes = await cliente('3314850000');
      const res = await enviar({ ...BOOKING_MX, booker: { ...BOOKING_MX.booker, phone: '+1 818 814 0000' } });
      expect(res.body.resultado).toBe('actualizada');
      const [o] = await ordenes();
      const nuevo = await cliente('+18188140000');
      expect(o.clienteId).toBe(nuevo.id);
      expect(o.clienteTelefono).toBe('+18188140000');
      expect(nuevo.totalPedidos).toBe(1);
      expect((await s.h.prisma.cliente.findUniqueOrThrow({ where: { id: antes.id } })).totalPedidos).toBe(0);
    });
  });

  describe('concurrencia', () => {
    it('la misma reserva 8 veces en paralelo crea una sola orden y un solo cliente', async () => {
      const resultados = await Promise.all(Array.from({ length: 8 }, () => enviar(BOOKING_MX)));
      expect(resultados.every((r) => r.status === 200)).toBe(true);
      expect(resultados.filter((r) => r.body.resultado === 'creada')).toHaveLength(1);
      expect(resultados.filter((r) => r.body.resultado === 'sin_cambios')).toHaveLength(7);
      expect(await ordenes()).toHaveLength(1);
      expect(await s.h.prisma.cliente.count()).toBe(1);
    });

    it('reservas distintas del mismo teléfono, en paralelo: un solo cliente y contador exacto', async () => {
      const mismas = [1, 2, 3, 4, 5, 6].map((n) => ({ ...BOOKING_MX, booking_id: 9000000000 + n }));
      const resultados = await Promise.all(mismas.map((b) => enviar(b)));
      expect(resultados.every((r) => r.body.resultado === 'creada')).toBe(true);
      expect(await s.h.prisma.cliente.count()).toBe(1);
      expect((await cliente('3314850000')).totalPedidos).toBe(6);
    });
  });

  describe('validaciones y autenticación', () => {
    const codigo = async (body: unknown) => {
      const res = await enviar(body);
      expect(res.status).toBe(400);
      return res.body.codigo;
    };
    it('errores 400 con código distinguible', async () => {
      expect(await codigo([BOOKING_MX])).toBe('FORMATO_INVALIDO');
      expect(await codigo({ ...BOOKING_MX, booking_id: undefined })).toBe('FALTA_ID');
      expect(await codigo({ ...BOOKING_MX, booking_id: '' })).toBe('FALTA_ID');
      expect(await codigo({ ...BOOKING_MX, status: 'no_show' })).toBe('ESTADO_DESCONOCIDO');
      expect(await codigo({ ...BOOKING_MX, checkout: BOOKING_MX.checkin })).toBe('FECHAS_INVALIDAS');
      expect(await codigo({ ...BOOKING_MX, checkout: '2026-10-10' })).toBe('FECHAS_INVALIDAS');
      expect(await codigo({ ...BOOKING_MX, checkin: 'mañana' })).toBe('FECHAS_INVALIDAS');
      expect(await codigo({ ...BOOKING_MX, total_amount_after_tax: 'abc' })).toBe('TOTAL_INVALIDO');
      expect(await ordenes()).toHaveLength(0);
    });
    it('llave inválida o ausente: 401', async () => {
      expect((await enviar(BOOKING_MX, 'otra-llave')).status).toBe(401);
      expect((await enviar(BOOKING_MX, null)).status).toBe(401);
      expect(await ordenes()).toHaveLength(0);
    });
    it('un negocio que no es hotel: 403', async () => {
      await s.h.prisma.tenant.create({ data: { slug: 'cafe', nombre: 'Cafe', botApiKey: 'key-cafe', tipoStorefront: 'RETAIL_B2C' } });
      const res = await enviar(BOOKING_MX, 'key-cafe');
      expect(res.status).toBe(403);
      expect(await ordenes()).toHaveLength(0);
    });
    it('aislamiento por tenant: el mismo booking_id en dos hoteles son dos reservas', async () => {
      await s.h.prisma.tenant.create({ data: { slug: 'hotel-b', nombre: 'B', botApiKey: 'key-b', tipoStorefront: 'HOTEL' } });
      await enviar(BOOKING_MX);
      await enviar(BOOKING_MX, 'key-b');
      expect(await ordenes()).toHaveLength(2);
    });
  });

  describe('un hotel con reservas guardadas', () => {
    beforeEach(async () => {
      await enviar(BOOKING_MX);
      await enviar(MODIFICADA_US);
      await enviar({ ...BOOKING_MX, booking_id: 1234567890, status: 'cancelled', booker: { ...BOOKING_MX.booker, phone: '+34 612 345 678' } });
    });

    it('la tienda y los endpoints públicos de B2C y B2B lo rechazan con 404', async () => {
      const srv = s.h.app.getHttpServer();
      const slug = s.base.tenant.slug;
      expect((await request(srv).get(`/public/tenants/${slug}/catalog`)).status).toBe(404);
      expect((await request(srv).post(`/public/tenants/${slug}/orders`).send(bodyCheckout(s.base))).status).toBe(404);
      expect((await request(srv).get(`/public/pedidos-b2b/tenants/${slug}`)).status).toBe(404);
      expect(await s.h.prisma.order.count({ where: { tipo: 'B2C' } })).toBe(0);
    });

    it('el panel no truena y las reservas no aparecen en pedidos, histórico, pagos ni métricas; los huéspedes sí en Clientes', async () => {
      const dueno = apiRol(s.h, s.base, 'DUENO');
      const rango = '?desde=2020-01-01T00:00:00.000Z&hasta=2030-01-01T00:00:00.000Z';
      const ok = async (url: string) => {
        const r = await dueno.get(url);
        expect([url, r.status]).toEqual([url, 200]);
        return r.body;
      };
      expect(await ok('/orders?soloPagados=true')).toEqual([]);
      expect((await ok('/orders/historico')).data).toEqual([]);
      expect(await ok(`/orders/summary${rango}`)).toMatchObject({ pedidosHoy: 0, ingresosHoy: '0.00' });
      await ok(`/orders/summary/daily${rango}`);
      await ok(`/orders/summary/estatus${rango}`);
      expect((await ok('/payments')).data ?? []).toEqual([]);
      await ok('/auth/me');
      await ok('/tenant/me');
      await ok('/reglas');
      expect((await ok('/clientes')).total).toBe(3);
      await ok('/clientes/activos');
      await ok(`/clientes/summary/daily${rango}`);
      sinEfectos();
    });

    it('bot-config de un hotel devuelve catalogoUrl nulo', async () => {
      const res = await request(s.h.app.getHttpServer()).get('/internal/bot-config').set('X-Api-Key', llave());
      expect(res.status).toBe(200);
      expect(res.body.catalogoUrl).toBeNull();
    });
  });

  describe('teléfono al enviar por Botpress (ReglaEnvioService real)', () => {
    it('mexicano → +52 + 10 dígitos; internacional → completo, sin +52', async () => {
      const envio = new ReglaEnvioService(s.h.prisma, { get: () => 'http://localhost:3000/tienda' } as any);
      const llamadas: any[] = [];
      const fetchOriginal = global.fetch;
      global.fetch = jest.fn(async (_u: any, init: any) => {
        llamadas.push(JSON.parse(init.body));
        return { ok: true } as Response;
      }) as any;
      try {
        const tenant = await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { botWebhookUrl: 'http://localhost:9/hook' } });
        await enviar(BOOKING_MX);
        await enviar(MODIFICADA_US);
        const regla = await s.h.prisma.regla.create({
          data: { tenantId: tenant.id, nombre: 'r', trigger: 'MANUAL', filtro: [], canal: 'WHATSAPP', plantillaNombre: 'p', plantillaIdioma: 'es', plantillaCategoria: 'UTILITY', plantillaVariables: [], activa: true } as any,
        });
        for (const tel of ['3314850000', '+18188140000']) {
          await envio.enviar(tenant, await cliente(tel), regla);
        }
        expect(llamadas.map((l) => l.telefono)).toEqual(['+523314850000', '+18188140000']);
      } finally {
        global.fetch = fetchOriginal;
      }
    });
  });
});
