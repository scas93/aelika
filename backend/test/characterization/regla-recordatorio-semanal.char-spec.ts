import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReglaBarridoService } from '../../src/notificaciones-reglas/regla-barrido.service';
import { ReglaCandadoService } from '../../src/notificaciones-reglas/regla-candado.service';
import { ReglasFiltroService } from '../../src/notificaciones-reglas/reglas-filtro.service';
import { crearClienteB2b } from '../../src/clientes/cliente-b2b';
import { expectError } from './exacto';
import { apiRol, altaClienteB2bDePrueba, crearAdminB2b, SEMANA_ACTUAL, SEMANA_PROXIMA, SEMANA_SIGUIENTE } from './b2b-helpers';
import { usarSuite } from './helpers';

// Recordatorio semanal de pedido (RECORDATORIO_SEMANAL_PEDIDO, solo mayoreo). El barrido es el REAL (filtro, candado, destinatarios y
// deduplicación reales sobre la base de pruebas); solo la frontera con Botpress (ReglaEnvioService.enviar) es un fake que deja una fila
// real en ReglaEnvioLog (con su `semanaInicio`, así que el índice único de la base hace de reserva igual que en producción).
//
// Reloj de la suite: miércoles 2026-09-30 10:00 CDMX → semana en curso 2026-09-28, semana siguiente 2026-10-05 (SEMANA_PROXIMA).
const VIERNES_13 = '2026-10-02T19:00:00.000Z'; // viernes 13:00 CDMX
const VIERNES_23_59 = '2026-10-03T05:59:00.000Z';
const SABADO_00 = '2026-10-03T06:00:00.000Z';
const SABADO_11 = '2026-10-03T17:00:00.000Z';
const VIERNES_SIGUIENTE_13 = '2026-10-09T19:00:00.000Z'; // ya en la semana siguiente: la «siguiente» pasa a ser 2026-10-12

describe('Reglas RECORDATORIO_SEMANAL_PEDIDO · barrido y «Ejecutar ahora»', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  let estadoEnvio: 'EXITO' | 'FALLO' | 'EN_CURSO' = 'EXITO';
  let barrido: ReglaBarridoService;
  const enviar = jest.fn();

  const nuevoCliente = (nombre: string, telefono = '5533334444') => altaClienteB2bDePrueba(s.h, s.base, { negocioNombre: nombre, contactoTelefono: telefono });
  const crearPedido = (clienteId: string, semanaInicio = SEMANA_PROXIMA) => crearAdminB2b(s.h, s.base, { clienteId, semanaInicio });
  const crearRegla = (extra: Record<string, unknown> = {}) =>
    s.h.prisma.regla.create({
      data: {
        tenantId: s.base.tenant.id,
        nombre: 'Recordatorio',
        trigger: 'RECORDATORIO_SEMANAL_PEDIDO',
        triggerConfig: { diaSemana: 'viernes', hora: 13 },
        filtro: [],
        canal: 'WHATSAPP',
        plantillaNombre: 'recordatorio_pedido',
        plantillaIdioma: 'es_MX',
        plantillaCategoria: 'UTILITY',
        plantillaVariables: [],
        activa: true,
        ...extra,
      } as any,
    });
  const enviadosA = () => enviar.mock.calls.map((c) => (c[1] as { id: string }).id);
  const ir = (iso: string) => jest.setSystemTime(new Date(iso));
  const ejecutar = (reglaId: string) => barrido.ejecutarRecordatorioAhora(reglaId, s.base.tenant.id);

  beforeEach(async () => {
    estadoEnvio = 'EXITO';
    await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { botWebhookUrl: 'http://localhost:9/hook' } });
    enviar.mockReset().mockImplementation(async (tenant, cliente, regla, _contexto, _orderId, semanaInicio) =>
      s.h.prisma.reglaEnvioLog.create({
        data: { tenantId: tenant.id, clienteId: cliente.id, reglaId: regla.id, categoria: regla.plantillaCategoria, estado: estadoEnvio, semanaInicio },
      }),
    );
    barrido = new ReglaBarridoService(s.h.prisma, new ReglasFiltroService(s.h.prisma), new ReglaCandadoService(s.h.prisma), { enviar } as any);
  });

  describe('programación (día y hora CDMX)', () => {
    it('fuera de su día y hora no envía; desde su hora hasta el fin de ese día sí; nunca al día siguiente', async () => {
      await crearRegla();
      const a = await nuevoCliente('A');

      await barrido.ejecutarBarrido(); // miércoles 10:00
      ir('2026-10-02T18:59:00.000Z'); // viernes 12:59
      await barrido.ejecutarBarrido();
      expect(enviar).not.toHaveBeenCalled();

      ir(VIERNES_13);
      await barrido.ejecutarBarrido();
      expect(enviadosA()).toEqual([a.id]);
    });

    it('una regla activada tarde ese mismo día aún envía ese día; el sábado a las 00:00 ya no', async () => {
      const regla = await crearRegla({ activa: false });
      await nuevoCliente('A');
      ir(VIERNES_13);
      await barrido.ejecutarBarrido();
      expect(enviar).not.toHaveBeenCalled(); // desactivada no envía

      ir(VIERNES_23_59);
      await s.h.prisma.regla.update({ where: { id: regla.id }, data: { activa: true } });
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(1);

      enviar.mockClear();
      await s.h.prisma.reglaEnvioLog.deleteMany({});
      ir(SABADO_00);
      await barrido.ejecutarBarrido();
      expect(enviar).not.toHaveBeenCalled();
    });

    it('no corre en un negocio que no es de mayoreo', async () => {
      await crearRegla();
      await nuevoCliente('A');
      await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { tipoStorefront: 'RETAIL_B2C' } });
      ir(VIERNES_13);
      await barrido.ejecutarBarrido();
      expect(enviar).not.toHaveBeenCalled();
    });
  });

  describe('destinatarios', () => {
    it('solo clientes activos con teléfono principal válido; con pedido de la semana siguiente no; cancelado sí; de otra semana sí', async () => {
      await crearRegla();
      const sinPedido = await nuevoCliente('Sin pedido', '5511110001');
      const conPedido = await nuevoCliente('Con pedido', '5511110002');
      const cancelado = await nuevoCliente('Pedido cancelado', '5511110003');
      const otraSemana = await nuevoCliente('Pedido semana en curso', '5511110004');
      const deBaja = await nuevoCliente('De baja', '5511110005');
      const telInvalido = await nuevoCliente('Teléfono inválido', '5511110006');
      const sinTelefono = await nuevoCliente('Sin teléfono', '5511110007');

      await crearPedido(conPedido.id);
      const pedidoCancelado = await crearPedido(cancelado.id);
      await s.h.prisma.order.update({ where: { id: pedidoCancelado.id }, data: { cancelado: true, canceladoAt: new Date() } });
      await crearPedido(otraSemana.id, SEMANA_ACTUAL);
      await s.h.prisma.cliente.update({ where: { id: deBaja.id }, data: { bajaAt: new Date() } });
      await s.h.prisma.clienteTelefono.updateMany({ where: { clienteId: telInvalido.id }, data: { telefono: '55111100' } }); // 8 dígitos
      await s.h.prisma.clienteTelefono.deleteMany({ where: { clienteId: sinTelefono.id } });

      ir(VIERNES_13);
      await barrido.ejecutarBarrido();
      expect(enviadosA().sort()).toEqual([sinPedido.id, cancelado.id, otraSemana.id].sort());
      // Cliente de baja, sin teléfono o con teléfono inválido: no se evalúa y no deja ningún registro.
      const logs = await s.h.prisma.reglaEnvioLog.findMany({ select: { clienteId: true } });
      expect(logs.map((l) => l.clienteId)).not.toEqual(expect.arrayContaining([deBaja.id]));
      expect(logs.map((l) => l.clienteId)).not.toEqual(expect.arrayContaining([telInvalido.id]));
      expect(logs.map((l) => l.clienteId)).not.toEqual(expect.arrayContaining([sinTelefono.id]));
    });

    it('un cliente de otro negocio nunca se evalúa', async () => {
      await crearRegla();
      await nuevoCliente('Mío');
      const otro = await s.h.prisma.tenant.create({ data: { slug: 'otro', nombre: 'Otro', botApiKey: 'key-otro', tipoStorefront: 'RETAIL_B2B' } as any });
      const cOtro = await crearClienteB2b(s.h.prisma, {
        tenantId: otro.id,
        tenantSlug: 'otro',
        nombre: 'Ajeno',
        direccion: 'x',
        modalidadPago: 'AL_FINAL',
        modalidadesActivas: ['AL_FINAL'],
        telefonos: [{ telefono: '5599990000', principal: true }],
      });
      ir(VIERNES_13);
      await barrido.ejecutarBarrido();
      expect(enviadosA()).not.toContain(cOtro.id);
      expect(enviar).toHaveBeenCalledTimes(1);
    });
  });

  describe('deduplicación por regla, cliente y semana', () => {
    it('varias corridas el mismo día no reenvían', async () => {
      await crearRegla();
      await nuevoCliente('A');
      ir(VIERNES_13);
      await barrido.ejecutarBarrido();
      ir('2026-10-02T20:00:00.000Z');
      await barrido.ejecutarBarrido();
      ir(VIERNES_23_59);
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(1);
    });

    it('un envío en FALLO es definitivo para esa semana (no se reintenta)', async () => {
      await crearRegla();
      await nuevoCliente('A');
      estadoEnvio = 'FALLO';
      ir(VIERNES_13);
      await barrido.ejecutarBarrido();
      estadoEnvio = 'EXITO';
      ir('2026-10-02T20:00:00.000Z');
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(1);
    });

    it('las dos reglas de Banetto son independientes: el sábado avisa otra vez a quien sigue sin pedir, y no a quien ya pidió', async () => {
      await crearRegla({ nombre: 'Viernes 13:00', triggerConfig: { diaSemana: 'viernes', hora: 13 } });
      await crearRegla({ nombre: 'Sábado 11:00', triggerConfig: { diaSemana: 'sabado', hora: 11 } });
      const sigueSinPedir = await nuevoCliente('Sigue sin pedir', '5511110001');
      const pideDespues = await nuevoCliente('Pide después del primer aviso', '5511110002');

      ir(VIERNES_13);
      await barrido.ejecutarBarrido();
      expect(enviadosA().sort()).toEqual([sigueSinPedir.id, pideDespues.id].sort());

      await crearPedido(pideDespues.id); // pide entre el primer aviso y el segundo
      enviar.mockClear();
      ir(SABADO_11);
      await barrido.ejecutarBarrido();
      expect(enviadosA()).toEqual([sigueSinPedir.id]);

      // El mismo sábado, otra corrida: nada más.
      enviar.mockClear();
      ir('2026-10-03T20:00:00.000Z');
      await barrido.ejecutarBarrido();
      expect(enviar).not.toHaveBeenCalled();
    });

    it('al cambiar de semana el cliente vuelve a ser elegible (los envíos de la semana anterior no bloquean)', async () => {
      await crearRegla();
      const a = await nuevoCliente('A');
      ir(VIERNES_13);
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(1);
      const semana1 = await s.h.prisma.reglaEnvioLog.findFirstOrThrow({ where: { clienteId: a.id } });
      expect(semana1.semanaInicio?.toISOString().slice(0, 10)).toBe(SEMANA_PROXIMA);

      ir(VIERNES_SIGUIENTE_13); // 2026-10-09: la semana siguiente ahora es 2026-10-12
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(2);
      const logs = await s.h.prisma.reglaEnvioLog.findMany({ where: { clienteId: a.id }, orderBy: { createdAt: 'asc' } });
      expect(logs.map((l) => l.semanaInicio?.toISOString().slice(0, 10))).toEqual([SEMANA_PROXIMA, SEMANA_SIGUIENTE]);
    });

    it('reactivada el mismo día solo envía a quien no se le envió ya esa semana', async () => {
      const regla = await crearRegla();
      const a = await nuevoCliente('A', '5511110001');
      ir(VIERNES_13);
      await barrido.ejecutarBarrido(); // A recibe
      await s.h.prisma.regla.update({ where: { id: regla.id }, data: { activa: false } });
      const b = await nuevoCliente('B', '5511110002');
      ir('2026-10-02T20:00:00.000Z');
      await barrido.ejecutarBarrido(); // desactivada: nada
      expect(enviadosA()).toEqual([a.id]);
      await s.h.prisma.regla.update({ where: { id: regla.id }, data: { activa: true } });
      await barrido.ejecutarBarrido(); // reactivada: solo B
      expect(enviadosA()).toEqual([a.id, b.id]);
    });

    it('barrido y «Ejecutar ahora» solapados no duplican (el índice único de la base es la reserva)', async () => {
      const regla = await crearRegla();
      for (let i = 1; i <= 5; i += 1) await nuevoCliente(`Cliente ${i}`, `55111100${String(i).padStart(2, '0')}`);
      ir(VIERNES_13);
      await Promise.all([barrido.ejecutarBarrido(), ejecutar(regla.id)]);
      const logs = await s.h.prisma.reglaEnvioLog.findMany({ where: { reglaId: regla.id } });
      expect(logs).toHaveLength(5);
      expect(new Set(logs.map((l) => l.clienteId)).size).toBe(5);
    });
  });

  describe('«Ejecutar ahora»', () => {
    it('evalúa lo mismo que el barrido sin la ventana de día/hora y resume; lo enviado cuenta para la semana', async () => {
      const regla = await crearRegla();
      const sin = await nuevoCliente('Sin pedido', '5511110001');
      const conPedido = await nuevoCliente('Con pedido', '5511110002');
      await nuevoCliente('De baja', '5511110003').then((c) => s.h.prisma.cliente.update({ where: { id: c.id }, data: { bajaAt: new Date() } }));
      await crearPedido(conPedido.id);

      // Miércoles 10:00, fuera de la ventana de la regla (viernes 13:00): a mano se ejecuta igual.
      const resumen = await ejecutar(regla.id);
      expect(resumen).toEqual({
        semanaInicio: SEMANA_PROXIMA,
        semanaFin: '2026-10-11',
        evaluadas: 2,
        enviadas: 1,
        yaEnviadasPorSemana: 0,
        fallidas: 0,
        omitidasPorPedido: 1,
      });
      expect(enviadosA()).toEqual([sin.id]);

      // Otra vez: nada nuevo, y se reporta como ya enviado esa semana.
      const segunda = await ejecutar(regla.id);
      expect(segunda).toMatchObject({ evaluadas: 2, enviadas: 0, yaEnviadasPorSemana: 1, omitidasPorPedido: 1 });

      // La ejecución programada del viernes no se lo reenvía.
      ir(VIERNES_13);
      await barrido.ejecutarBarrido();
      expect(enviar).toHaveBeenCalledTimes(1);
    });

    it('un envío que Botpress rechaza cuenta como fallido', async () => {
      const regla = await crearRegla();
      await nuevoCliente('A');
      estadoEnvio = 'FALLO';
      expect(await ejecutar(regla.id)).toMatchObject({ evaluadas: 1, enviadas: 0, fallidas: 1 });
    });

    it('sin webhook configurado el envío no se intenta: fallida, sin registro, y se reevalúa después', async () => {
      const regla = await crearRegla();
      await nuevoCliente('A');
      enviar.mockRejectedValue(new BadRequestException('sin webhook'));
      expect(await ejecutar(regla.id)).toMatchObject({ evaluadas: 1, enviadas: 0, fallidas: 1 });
      expect(await s.h.prisma.reglaEnvioLog.count()).toBe(0);
    });

    it('rechaza reglas de otro tipo, inactivas, de otro negocio y una ejecución simultánea de la misma regla', async () => {
      const inactiva = await crearRegla({ activa: false });
      await expect(ejecutar(inactiva.id)).rejects.toThrow('inactiva');
      const manual = await s.h.prisma.regla.create({
        data: { tenantId: s.base.tenant.id, nombre: 'm', trigger: 'MANUAL', filtro: [], canal: 'WHATSAPP', plantillaNombre: 'x', plantillaIdioma: 'es', plantillaCategoria: 'UTILITY', plantillaVariables: [] } as any,
      });
      await expect(ejecutar(manual.id)).rejects.toThrow(BadRequestException);
      await expect(barrido.ejecutarRecordatorioAhora('no-existe', s.base.tenant.id)).rejects.toThrow('no encontrada');

      const regla = await crearRegla();
      await nuevoCliente('A');
      // La primera ejecución se detiene dentro del envío hasta que se libere: así la segunda llega con la regla «en ejecución».
      let liberar!: () => void;
      const compuerta = new Promise<void>((r) => (liberar = r));
      const original = enviar.getMockImplementation()!;
      enviar.mockImplementation(async (...args: unknown[]) => {
        await compuerta;
        return original(...args);
      });
      const lenta = ejecutar(regla.id);
      while (enviar.mock.calls.length === 0) await new Promise((r) => setTimeout(r, 5));
      await expect(ejecutar(regla.id)).rejects.toThrow(ConflictException);
      liberar();
      expect(await lenta).toMatchObject({ enviadas: 1 });
    });

    it('ejecutarAhora despacha por tipo: recordatorio semanal al nuevo, el resto al de reservas con su mismo error', async () => {
      const regla = await crearRegla();
      await nuevoCliente('A');
      expect(await barrido.ejecutarAhora(regla.id, s.base.tenant.id)).toMatchObject({ evaluadas: 1, enviadas: 1 });
      const manual = await s.h.prisma.regla.create({
        data: { tenantId: s.base.tenant.id, nombre: 'm', trigger: 'MANUAL', filtro: [], canal: 'WHATSAPP', plantillaNombre: 'x', plantillaIdioma: 'es', plantillaCategoria: 'UTILITY', plantillaVariables: [] } as any,
      });
      await expect(barrido.ejecutarAhora(manual.id, s.base.tenant.id)).rejects.toThrow('Solo se puede ejecutar ahora una regla de reservas');
    });
  });

  describe('API POST /reglas/:id/ejecutar-ahora', () => {
    // El harness sustituye ReglaBarridoService por un objeto vacío; aquí se le conecta el método real (con el envío falso).
    let stub: any;
    beforeEach(() => {
      stub = s.h.app.get(ReglaBarridoService);
      stub.ejecutarAhora = (id: string, tenantId: string) => barrido.ejecutarAhora(id, tenantId);
    });
    afterEach(() => {
      delete stub.ejecutarAhora;
    });

    it('el Dueño la ejecuta y recibe el resumen; Gerente y Operador 403 sin enviar nada', async () => {
      const regla = await crearRegla();
      const sin = await nuevoCliente('Sin pedido', '5511110001');
      const con = await nuevoCliente('Con pedido', '5511110002');
      await crearPedido(con.id);
      for (const rol of ['GERENTE', 'OPERADOR'] as const) {
        expect((await apiRol(s.h, s.base, rol).post(`/reglas/${regla.id}/ejecutar-ahora`)).status).toBe(403);
      }
      expect(enviar).not.toHaveBeenCalled();
      const res = await apiRol(s.h, s.base, 'DUENO').post(`/reglas/${regla.id}/ejecutar-ahora`);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ semanaInicio: SEMANA_PROXIMA, semanaFin: '2026-10-11', evaluadas: 2, enviadas: 1, yaEnviadasPorSemana: 0, fallidas: 0, omitidasPorPedido: 1 });
      expect(enviadosA()).toEqual([sin.id]);
    });
  });

  describe('API: crear y editar la regla', () => {
    const cuerpo = (extra: Record<string, unknown> = {}) => ({
      nombre: 'Recordatorio viernes',
      trigger: 'RECORDATORIO_SEMANAL_PEDIDO',
      triggerConfig: { diaSemana: 'viernes', hora: 13 },
      plantillaNombre: 'recordatorio_pedido',
      plantillaIdioma: 'es_MX',
      plantillaCategoria: 'UTILITY',
      plantillaVariables: [
        { posicion: 1, fuente: 'CAMPO_CLIENTE', valor: 'nombre' },
        { posicion: 2, fuente: 'SEMANA_SIGUIENTE', valor: 'inicio' },
        { posicion: 3, fuente: 'SEMANA_SIGUIENTE', valor: 'fin' },
      ],
      botonUrlValor: 'panaderia-banetto',
      ...extra,
    });

    it('el Dueño la crea en mayoreo; guarda el botón, ignora el filtro y la lee de vuelta', async () => {
      const res = await apiRol(s.h, s.base, 'DUENO').post('/reglas').send(cuerpo({ filtro: [{ campo: 'TOTAL_PEDIDOS', operador: 'IGUAL', valor: 0 }] }));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ trigger: 'RECORDATORIO_SEMANAL_PEDIDO', plantillaCategoria: 'UTILITY', filtro: [], botonUrlValor: 'panaderia-banetto', triggerConfig: { diaSemana: 'viernes', hora: 13 } });
      const lista = await apiRol(s.h, s.base, 'DUENO').get('/reglas').expect(200);
      expect(lista.body[0].botonUrlValor).toBe('panaderia-banetto');
    });

    it('solo Dueño: Gerente y Operador 403', async () => {
      for (const rol of ['GERENTE', 'OPERADOR'] as const) {
        expectError(await apiRol(s.h, s.base, rol).post('/reglas').send(cuerpo()), 403, 'No tienes permiso para realizar esta acción');
      }
    });

    it('rechaza categoría Marketing, configuración inválida, variables de otro tipo y un botón con dominio', async () => {
      const dueno = () => apiRol(s.h, s.base, 'DUENO');
      expect((await dueno().post('/reglas').send(cuerpo({ plantillaCategoria: 'MARKETING' }))).status).toBe(400);
      expect((await dueno().post('/reglas').send(cuerpo({ triggerConfig: { diaSemana: 'viernes', hora: 25 } }))).status).toBe(400);
      expect((await dueno().post('/reglas').send(cuerpo({ triggerConfig: undefined }))).status).toBe(400);
      expect((await dueno().post('/reglas').send(cuerpo({ plantillaVariables: [{ posicion: 1, fuente: 'CAMPO_PEDIDO', valor: 'folio' }] }))).status).toBe(400);
      expect((await dueno().post('/reglas').send(cuerpo({ botonUrlValor: 'https://pide.aelika.com/panaderia-banetto' }))).status).toBe(400);
      expect(await s.h.prisma.regla.count()).toBe(0);
    });

    it('en menudeo y en hotel el backend lo rechaza; las variables de semana tampoco valen en otros tipos', async () => {
      for (const tipo of ['RETAIL_B2C', 'HOTEL'] as const) {
        await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { tipoStorefront: tipo } });
        const res = await apiRol(s.h, s.base, 'DUENO').post('/reglas').send(cuerpo());
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('mayoreo');
      }
      await s.h.prisma.tenant.update({ where: { id: s.base.tenant.id }, data: { tipoStorefront: 'RETAIL_B2B' } });
      const manual = cuerpo({ trigger: 'MANUAL', triggerConfig: undefined, botonUrlValor: undefined });
      expect((await apiRol(s.h, s.base, 'DUENO').post('/reglas').send(manual)).status).toBe(400); // SEMANA_SIGUIENTE solo en el recordatorio
    });

    it('editar: cambia día/hora y quita el botón con null; el botón no se toca si no viene', async () => {
      const creada = (await apiRol(s.h, s.base, 'DUENO').post('/reglas').send(cuerpo())).body;
      const a = await apiRol(s.h, s.base, 'DUENO').patch(`/reglas/${creada.id}`).send({ triggerConfig: { diaSemana: 'sabado', hora: 11 } });
      expect(a.status).toBe(200);
      expect(a.body).toMatchObject({ triggerConfig: { diaSemana: 'sabado', hora: 11 }, botonUrlValor: 'panaderia-banetto' });
      const b = await apiRol(s.h, s.base, 'DUENO').patch(`/reglas/${creada.id}`).send({ botonUrlValor: null });
      expect(b.body.botonUrlValor).toBeNull();
      const c = await apiRol(s.h, s.base, 'DUENO').patch(`/reglas/${creada.id}`).send({ plantillaCategoria: 'MARKETING' });
      expect(c.status).toBe(400);
    });

    it('las reglas de siempre siguen sin botón (botonUrlValor null)', async () => {
      const res = await apiRol(s.h, s.base, 'DUENO')
        .post('/reglas')
        .send({ nombre: 'Manual', trigger: 'MANUAL', plantillaNombre: 'x', plantillaIdioma: 'es_MX', plantillaCategoria: 'MARKETING' });
      expect(res.status).toBe(201);
      expect(res.body.botonUrlValor).toBeNull();
    });
  });
});
