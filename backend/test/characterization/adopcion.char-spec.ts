import { ClienteCanal } from '../../generated/prisma/client';
import { BaseSeed, seedBase } from './db';
import { usarSuite, AHORA } from './helpers';
import {
  SEMANA_ACTUAL,
  SEMANA_PASADA,
  SEMANA_PROXIMA,
  altaClienteB2bDePrueba,
  apiRol,
  crearAdminB2b,
} from './b2b-helpers';

// Módulo Adopción (solo lectura, solo Dueño, mayoreo). Reloj: miércoles 2026-09-30 10:00 CDMX.
// Semana en curso 2026-09-28; próxima (default) 2026-10-05; anteriores a la próxima: 09-28, 09-21, 09-14, 09-07.
const SEM_14 = '2026-09-14';
const horas = (n: number) => new Date(new Date(AHORA).getTime() - n * 3_600_000);

describe('Adopción · Clientes e Interno', () => {
  const s = usarSuite({ seed: { tipoStorefront: 'RETAIL_B2B' } });
  const dueno = () => apiRol(s.h, s.base, 'DUENO');
  const entorno = process.env.CONFIRMADO_AT_DESDE;
  afterEach(() => {
    if (entorno === undefined) delete process.env.CONFIRMADO_AT_DESDE;
    else process.env.CONFIRMADO_AT_DESDE = entorno;
  });

  let tel = 5500000000;
  const cliente = async (nombre: string, base: BaseSeed = s.base) =>
    altaClienteB2bDePrueba(s.h, base, { negocioNombre: nombre, contactoTelefono: String(tel++) });
  /** Crea un pedido (por el panel) y lo deja en la semana indicada. */
  async function pedido(c: { id: string }, semana: string, base: BaseSeed = s.base) {
    const p = await crearAdminB2b(s.h, base, { clienteId: c.id });
    if (semana !== SEMANA_PROXIMA)
      await s.h.prisma.detalleB2B.update({
        where: { orderId: p.id },
        data: { semanaInicio: new Date(`${semana}T00:00:00.000Z`) },
      });
    return p as { id: string; folio: string };
  }
  const confirmar = (id: string) => dueno().patch(`/pedidos-b2b/${id}/avanzar`).expect(200);
  const clientes = async (q = '') => (await dueno().get(`/adopcion/clientes${q}`).expect(200)).body;
  const interno = async () => (await dueno().get('/adopcion/interno').expect(200)).body;
  const fila = (body: any, nombre: string) => body.clientes.find((c: any) => c.nombre === nombre);

  describe('GET /adopcion/clientes', () => {
    it('semana por defecto = la próxima (lunes a domingo, hora de CDMX); acepta ?semana', async () => {
      const b = await clientes();
      expect(b.semana).toMatchObject({
        inicio: SEMANA_PROXIMA,
        fin: '2026-10-11',
        esProxima: true,
        esActual: false,
        enCurso: SEMANA_ACTUAL,
      });
      const c = await clientes(`?semana=${SEMANA_ACTUAL}`);
      expect(c.semana).toMatchObject({ inicio: SEMANA_ACTUAL, esActual: true, esProxima: false });
      await dueno().get('/adopcion/clientes?semana=2026-10-06').expect(400); // no es lunes
      await dueno().get('/adopcion/clientes?semana=hola').expect(400);
    });

    it('estados de la semana, habituales primero, y la suma por estado = total de clientes', async () => {
      const habitual = await cliente('Habitual sin pedir');
      await pedido(habitual, SEMANA_ACTUAL);
      await pedido(habitual, SEMANA_PASADA);
      const pidio = await cliente('Pidió');
      await confirmar((await pedido(pidio, SEMANA_PROXIMA)).id);
      await cliente('Sin confirmar').then((c) => pedido(c, SEMANA_PROXIMA));
      const cancelado = await cliente('Cancelado');
      const pc = await pedido(cancelado, SEMANA_PROXIMA);
      await dueno().patch(`/pedidos-b2b/${pc.id}/cancelar`).expect(200);
      const vuelve = await cliente('Cancelado y vuelve');
      const pv = await pedido(vuelve, SEMANA_PROXIMA);
      await dueno().patch(`/pedidos-b2b/${pv.id}/cancelar`).expect(200);
      await confirmar((await pedido(vuelve, SEMANA_PROXIMA)).id);
      await cliente('Nada');
      // Solo 1 de las 4 semanas anteriores → no es habitual.
      const poco = await cliente('Pidió una vez');
      await pedido(poco, SEMANA_ACTUAL);

      const b = await clientes();
      const estados = Object.fromEntries(b.clientes.map((c: any) => [c.nombre, c.estado]));
      expect(estados).toMatchObject({
        'Habitual sin pedir': 'NO_HA_PEDIDO_HABITUAL',
        Pidió: 'PIDIO',
        'Sin confirmar': 'SIN_CONFIRMAR',
        Cancelado: 'CANCELADO',
        'Cancelado y vuelve': 'PIDIO',
        Nada: 'NO_HA_PEDIDO',
        'Pidió una vez': 'NO_HA_PEDIDO',
      });
      expect(b.clientes[0].nombre).toBe('Habitual sin pedir'); // habituales primero
      expect(b.resumen).toMatchObject({
        totalClientes: 7,
        pidieron: 3,
        sinConfirmar: 1,
        habitualesSinPedir: 1,
        cancelaron: 1,
      });
      const suma = Object.values(b.resumen.porEstado as Record<string, number>).reduce((n, x) => n + x, 0);
      expect(suma).toBe(b.resumen.totalClientes);
      expect(b.resumen.totalClientes).toBe(b.clientes.length);
      expect(await s.h.prisma.cliente.count({ where: { canal: ClienteCanal.B2B } })).toBe(7);
    });

    it('etapa de activación: la más alta alcanzada, sin exigir las anteriores', async () => {
      await cliente('Sin actividad');
      const accedio = await cliente('Accedió');
      await s.h.prisma.cliente.update({ where: { id: accedio.id }, data: { ultimoAccesoAt: horas(5) } });
      const hizo = await cliente('Hizo pedido'); // pedido, nunca accedió
      await pedido(hizo, SEMANA_ACTUAL);
      const regular = await cliente('Regular');
      for (const w of [SEMANA_ACTUAL, SEMANA_PASADA, SEM_14]) await pedido(regular, w);

      const b = await clientes();
      expect(fila(b, 'Sin actividad')).toMatchObject({ etapa: 'SIN_ACTIVIDAD', ultimoAccesoAt: null, primerPedidoAt: null });
      expect(fila(b, 'Accedió')).toMatchObject({ etapa: 'ACCEDIO' });
      expect(fila(b, 'Accedió').ultimoAccesoAt).toBe(horas(5).toISOString());
      expect(fila(b, 'Hizo pedido')).toMatchObject({ etapa: 'HIZO_PEDIDO', pedidosUltimas4Semanas: 1 });
      expect(fila(b, 'Hizo pedido').primerPedidoAt).toBe(AHORA);
      expect(fila(b, 'Regular')).toMatchObject({ etapa: 'PIDE_CON_REGULARIDAD', pedidosUltimas4Semanas: 3, estado: 'NO_HA_PEDIDO_HABITUAL' });
    });

    it('clientes de baja: fuera de la tabla y de las cuentas salvo que tengan pedido en la semana', async () => {
      const bajaSin = await cliente('Baja sin pedido');
      const bajaCon = await cliente('Baja con pedido');
      await pedido(bajaCon, SEMANA_PROXIMA);
      await cliente('Activo');
      await s.h.prisma.cliente.updateMany({ where: { id: { in: [bajaSin.id, bajaCon.id] } }, data: { bajaAt: new Date(AHORA) } });
      const b = await clientes();
      expect(b.clientes.map((c: any) => c.nombre).sort()).toEqual(['Activo', 'Baja con pedido']);
      expect(b.resumen.totalClientes).toBe(2);
    });

    it('marca de «modificó y no se reconfirma»', async () => {
      const c = await cliente('Modificó');
      const p = await pedido(c, SEMANA_PROXIMA);
      await s.h.prisma.order.update({ where: { id: p.id }, data: { modificadoPorClienteAt: new Date(AHORA) } });
      const otro = await cliente('No modificó');
      await pedido(otro, SEMANA_PROXIMA);
      const b = await clientes();
      expect(fila(b, 'Modificó').modificadoSinReconfirmar).toBe(true);
      expect(fila(b, 'No modificó').modificadoSinReconfirmar).toBe(false);
      expect(fila(b, 'Modificó').pedidoId).toBe(p.id);
    });

    it('cancelados después de confirmar: solo pedidos con fecha de confirmación; lista vacía si no hay', async () => {
      process.env.CONFIRMADO_AT_DESDE = new Date(new Date(AHORA).getTime() - 86_400_000).toISOString();
      const conFecha = await cliente('Cancela confirmado');
      const p1 = await pedido(conFecha, SEMANA_PROXIMA);
      await confirmar(p1.id);
      await dueno().patch(`/pedidos-b2b/${p1.id}/cancelar`).expect(200);
      const sinConfirmar = await cliente('Cancela sin confirmar');
      const p2 = await pedido(sinConfirmar, SEMANA_PROXIMA);
      await dueno().patch(`/pedidos-b2b/${p2.id}/cancelar`).expect(200);

      const b = await clientes();
      expect(b.canceladosDespuesDeConfirmar).toHaveLength(1);
      expect(b.canceladosDespuesDeConfirmar[0]).toMatchObject({ pedidoId: p1.id, cliente: 'Cancela confirmado', confirmadoAt: AHORA });
      expect(b.avisos.confirmadoAtDesde).toBe(process.env.CONFIRMADO_AT_DESDE);
      expect((await clientes(`?semana=${SEMANA_ACTUAL}`)).canceladosDespuesDeConfirmar).toEqual([]);
    });

    it('origen: porcentajes solo sobre pedidos con dato; sin dato no se cuentan ni se asumen', async () => {
      const c = await cliente('Mixto');
      const ids: string[] = [];
      for (const w of [SEM_14, SEMANA_PASADA, SEMANA_ACTUAL, SEMANA_PROXIMA]) ids.push((await pedido(c, w)).id);
      // 2 panel, 1 portal, 1 sin dato
      await s.h.prisma.detalleB2B.update({ where: { orderId: ids[1] }, data: { origen: 'PORTAL_CLIENTE' } });
      await s.h.prisma.detalleB2B.update({ where: { orderId: ids[2] }, data: { origen: null } });
      const solo = await cliente('Sin dato');
      const p = await pedido(solo, SEMANA_PROXIMA);
      await s.h.prisma.detalleB2B.update({ where: { orderId: p.id }, data: { origen: null } });

      const b = await clientes();
      expect(fila(b, 'Mixto').origen).toEqual({ casos: 3, portal: 1, panel: 2, porcentajePortal: 33.3, porcentajePanel: 66.7 });
      expect(fila(b, 'Sin dato').origen).toEqual({ casos: 0, portal: 0, panel: 0, porcentajePortal: null, porcentajePanel: null });
      expect(b.origen).toMatchObject({ casos: 3, portal: 1, panel: 2 });
    });

    it('un negocio sin datos responde vacío y coherente', async () => {
      const b = await clientes();
      expect(b.clientes).toEqual([]);
      expect(b.resumen).toMatchObject({ totalClientes: 0, pidieron: 0 });
      expect(b.origen).toMatchObject({ casos: 0, porcentajePortal: null });
    });
  });

  describe('GET /adopcion/interno', () => {
    it('sin datos: todo en cero / null', async () => {
      const b = await interno();
      expect(b.sinConfirmar).toEqual({ total: 0, items: [] });
      expect(b.entregasAtrasadas).toEqual({ total: 0, items: [] });
      expect(b.semanasPasadasSinCompletar).toEqual({ total: 0, items: [] });
      expect(b.tiempos.recibidoAConfirmado).toEqual({ casos: 0, medianaHoras: null, maximoHoras: null });
      expect(b.tiempos.puntualidad).toMatchObject({ casos: 0, porcentajeATiempo: null });
      expect(b.tiempos.noRecogidas).toBe(0);
      expect(b.semanaEnCurso).toBe(SEMANA_ACTUAL);
    });

    it('pedidos sin confirmar (con antigüedad e incluidos los de semanas pasadas) y semanas pasadas sin completar', async () => {
      const c1 = await cliente('Reciente');
      const p1 = await pedido(c1, SEMANA_PROXIMA);
      const c2 = await cliente('Antiguo semana pasada');
      const p2 = await pedido(c2, SEMANA_PASADA);
      await s.h.prisma.order.update({ where: { id: p2.id }, data: { createdAt: horas(72) } });
      const c3 = await cliente('Confirmado semana pasada');
      const p3 = await pedido(c3, SEMANA_PASADA);
      await confirmar(p3.id);
      const c4 = await cliente('Cancelado semana pasada');
      const p4 = await pedido(c4, SEMANA_PASADA);
      await dueno().patch(`/pedidos-b2b/${p4.id}/cancelar`).expect(200);
      const c5 = await cliente('Completado semana pasada');
      const p5 = await pedido(c5, SEMANA_PASADA);
      await s.h.prisma.order.update({ where: { id: p5.id }, data: { estadoPedido: 'COMPLETADO' } });

      const b = await interno();
      expect(b.sinConfirmar.total).toBe(2);
      expect(b.sinConfirmar.items.map((i: any) => i.pedidoId)).toEqual([p2.id, p1.id]); // más antiguo primero
      expect(b.sinConfirmar.items[0]).toMatchObject({ folio: p2.folio, cliente: 'Antiguo semana pasada', horasEspera: 72, deSemanaPasada: true });
      expect(b.sinConfirmar.items[1]).toMatchObject({ deSemanaPasada: false });
      expect(b.semanasPasadasSinCompletar.total).toBe(2);
      expect(b.semanasPasadasSinCompletar.items.map((i: any) => i.pedidoId).sort()).toEqual([p2.id, p3.id].sort());
      expect(b.semanasPasadasSinCompletar.items.find((i: any) => i.pedidoId === p3.id).estado).toBe('CONFIRMADO_SURTIENDO');
    });

    it('entregas atrasadas: pendientes con fecha anterior a hoy (CDMX); no las cerradas ni las de hoy', async () => {
      const c = await cliente('Atrasos');
      const p = await pedido(c, SEMANA_ACTUAL);
      const entregas = await s.h.prisma.entrega.findMany({ where: { orderId: p.id }, orderBy: { fecha: 'asc' } });
      expect(entregas.length).toBeGreaterThanOrEqual(3);
      const f = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
      await s.h.prisma.entrega.update({ where: { id: entregas[0].id }, data: { fecha: f('2026-09-28') } }); // atrasada
      await s.h.prisma.entrega.update({ where: { id: entregas[1].id }, data: { fecha: f('2026-09-29'), estado: 'ENTREGADA' } }); // cerrada
      await s.h.prisma.entrega.update({ where: { id: entregas[2].id }, data: { fecha: f('2026-09-30') } }); // hoy: no
      const b = await interno();
      expect(b.entregasAtrasadas.total).toBe(1);
      expect(b.entregasAtrasadas.items[0]).toMatchObject({ entregaId: entregas[0].id, pedidoId: p.id, fecha: '2026-09-28', diasAtraso: 2, cliente: 'Atrasos' });
    });

    it('recibido → confirmado: mediana y más lento sobre pedidos con fecha; muestra los casos medidos', async () => {
      const dato = async (nombre: string, creadoHaceH: number, confirmaDespuesH: number | null, semana = SEMANA_PROXIMA) => {
        const p = await pedido(await cliente(nombre), semana);
        await s.h.prisma.order.update({ where: { id: p.id }, data: { createdAt: horas(creadoHaceH) } });
        if (confirmaDespuesH !== null)
          await s.h.prisma.detalleB2B.update({
            where: { orderId: p.id },
            data: { confirmadoAt: new Date(horas(creadoHaceH).getTime() + confirmaDespuesH * 3_600_000) },
          });
      };
      await dato('a', 100, 2);
      await dato('b', 100, 4);
      await dato('c', 100, 30);
      await dato('sin fecha', 100, null);
      await dato('fuera de ventana', 24 * 40, 1);
      const t = (await interno()).tiempos;
      expect(t.pedidosEnVentana).toBe(4);
      expect(t.recibidoAConfirmado).toEqual({ casos: 3, medianaHoras: 4, maximoHoras: 30 });
    });

    it('puntualidad: solo ENTREGADA con fecha de cierre; NO_RECOGIDA aparte', async () => {
      const c = await cliente('Puntual');
      const p = await pedido(c, SEMANA_ACTUAL);
      const e = await s.h.prisma.entrega.findMany({ where: { orderId: p.id }, orderBy: { fecha: 'asc' } });
      const f = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
      // a tiempo: cerrada el día programado (14:00 CDMX = 20:00Z)
      await s.h.prisma.entrega.update({ where: { id: e[0].id }, data: { fecha: f('2026-09-28'), estado: 'ENTREGADA', estadoCambiadoAt: new Date('2026-09-28T20:00:00.000Z') } });
      // después: cerrada dos días más tarde
      await s.h.prisma.entrega.update({ where: { id: e[1].id }, data: { fecha: f('2026-09-28'), estado: 'ENTREGADA', estadoCambiadoAt: new Date('2026-09-30T20:00:00.000Z') } });
      // sin fecha de cierre (no se mide)
      await s.h.prisma.entrega.update({ where: { id: e[2].id }, data: { fecha: f('2026-09-29'), estado: 'ENTREGADA', estadoCambiadoAt: null } });
      const extra = await pedido(await cliente('NoRecoge'), SEMANA_ACTUAL);
      const [x] = await s.h.prisma.entrega.findMany({ where: { orderId: extra.id } });
      await s.h.prisma.entrega.update({ where: { id: x.id }, data: { fecha: f('2026-09-28'), estado: 'NO_RECOGIDA', estadoCambiadoAt: new Date('2026-09-28T20:00:00.000Z') } });

      const t = (await interno()).tiempos;
      expect(t.puntualidad).toEqual({ casos: 2, aTiempo: 1, despues: 1, sinDato: 1, porcentajeATiempo: 50 });
      expect(t.noRecogidas).toBe(1);
    });
  });

  describe('aislamiento por tenant', () => {
    it('los datos de otro negocio nunca aparecen', async () => {
      const otra = await seedBase(s.h.prisma, { slug: 'otro-mayoreo', tipoStorefront: 'RETAIL_B2B' });
      const suyo = await cliente('Cliente de otro', otra);
      const p = await pedido(suyo, SEMANA_PASADA, otra);
      await s.h.prisma.order.update({ where: { id: p.id }, data: { createdAt: horas(100) } });
      await cliente('Mío');

      const b = await clientes();
      expect(b.clientes.map((c: any) => c.nombre)).toEqual(['Mío']);
      const i = await interno();
      expect(i.sinConfirmar.total).toBe(0);
      expect(i.semanasPasadasSinCompletar.total).toBe(0);
      const deOtra = await apiRol(s.h, otra, 'DUENO').get('/adopcion/clientes').expect(200);
      expect(deOtra.body.clientes.map((c: any) => c.nombre)).toEqual(['Cliente de otro']);
    });
  });

  describe('roles', () => {
    it('Operador y Gerente reciben 403 en ambos endpoints; sin sesión 401', async () => {
      for (const rol of ['OPERADOR', 'GERENTE'] as const) {
        await apiRol(s.h, s.base, rol).get('/adopcion/clientes').expect(403);
        await apiRol(s.h, s.base, rol).get('/adopcion/interno').expect(403);
      }
      const sin = (await import('supertest')).default(s.h.app.getHttpServer());
      await sin.get('/adopcion/clientes').expect(401);
      await sin.get('/adopcion/interno').expect(401);
    });
  });
});
