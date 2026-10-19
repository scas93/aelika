import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ClienteCanal,
  EstadoEntrega,
  EstadoPedido,
  OrigenPedidoB2b,
  TipoOrden,
} from '../../generated/prisma/client';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';
import { sumarDiasISO } from '../pedidos-b2b/pedidos-b2b-logica';
import {
  ESTADOS_B2B_COMPLETADOS,
  corteConfirmadoAt,
  estadoB2bVisible,
} from '../pedidos-b2b/pedidos-b2b-estados';
import {
  DIAS_VENTANA,
  esLunes,
  estadoEnSemana,
  etapaActivacion,
  horasRecibidoAConfirmado,
  puntualidadEntregas,
  resumenOrigen,
  semanasAnteriores,
  semanasConPedido,
  semanasReferencia,
  type EstadoSemana,
  type PedidoResumen,
} from './adopcion-calculo';

/** Máximo de filas por lista del tab Interno (el total real siempre se informa aparte). */
const MAX_FILAS = 100;

const aFecha = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
const aYmd = (d: Date) => d.toISOString().slice(0, 10);

const ESTADOS_SEMANA: EstadoSemana[] = [
  'PIDIO',
  'SIN_CONFIRMAR',
  'CANCELADO',
  'NO_HA_PEDIDO_HABITUAL',
  'NO_HA_PEDIDO',
];

/**
 * Módulo Adopción (solo lectura, solo Dueño, solo negocios de mayoreo). Todo sale de datos que ya existen; todas las
 * consultas pasan por TenantPrismaService (tenant de la sesión) y son agregadas: nunca una consulta por cliente.
 */
@Injectable()
export class AdopcionService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  private get db() {
    return this.tenantPrisma.client;
  }

  private avisos() {
    const corte = corteConfirmadoAt();
    return { confirmadoAtDesde: corte ? corte.toISOString() : null };
  }

  // ------------------------------------------------------------------ Clientes

  async clientes(semanaParam?: string) {
    const ref = semanasReferencia();
    const seleccionada = semanaParam ?? ref.proxima;
    if (!esLunes(seleccionada))
      throw new BadRequestException(
        '"semana" debe ser el lunes de una semana (YYYY-MM-DD)',
      );

    const anteriores = semanasAnteriores(seleccionada);
    const desde = anteriores[anteriores.length - 1];

    const [filas, primeros, modificados, porPortal, porPanel, clientes] =
      await Promise.all([
        // Pedidos de la ventana (4 semanas anteriores + la seleccionada), cancelados incluidos.
        this.db.order.findMany({
          where: {
            tipo: TipoOrden.B2B,
            detalleB2b: {
              semanaInicio: { gte: aFecha(desde), lte: aFecha(seleccionada) },
            },
          },
          select: {
            id: true,
            folio: true,
            clienteId: true,
            cancelado: true,
            canceladoAt: true,
            estadoPedido: true,
            detalleB2b: {
              select: {
                semanaInicio: true,
                confirmadoAt: true,
                negocioNombre: true,
              },
            },
          },
        }),
        // Primer pedido (no cancelado) de cada cliente, de toda la historia.
        this.db.order.groupBy({
          by: ['clienteId'],
          where: { tipo: TipoOrden.B2B, cancelado: false },
          _min: { createdAt: true },
        }),
        // Clientes con un pedido modificado por ellos que sigue sin reconfirmar.
        this.db.order.groupBy({
          by: ['clienteId'],
          where: {
            tipo: TipoOrden.B2B,
            cancelado: false,
            modificadoPorClienteAt: { not: null },
          },
          _count: { _all: true },
        }),
        // Origen: solo pedidos con dato (los anteriores al campo no se cuentan ni se asumen).
        this.db.order.groupBy({
          by: ['clienteId'],
          where: {
            tipo: TipoOrden.B2B,
            detalleB2b: { origen: OrigenPedidoB2b.PORTAL_CLIENTE },
          },
          _count: { _all: true },
        }),
        this.db.order.groupBy({
          by: ['clienteId'],
          where: {
            tipo: TipoOrden.B2B,
            detalleB2b: { origen: OrigenPedidoB2b.PANEL_EQUIPO },
          },
          _count: { _all: true },
        }),
        this.db.cliente.findMany({
          where: { canal: ClienteCanal.B2B },
          select: {
            id: true,
            nombre: true,
            codigo: true,
            ultimoAccesoAt: true,
            bajaAt: true,
          },
        }),
      ]);

    const pedidos: (PedidoResumen & { id: string; folio: string })[] =
      filas.map((o) => ({
        id: o.id,
        folio: o.folio,
        clienteId: o.clienteId,
        semana: aYmd(o.detalleB2b!.semanaInicio),
        cancelado: o.cancelado,
        porConfirmar: o.estadoPedido === EstadoPedido.PENDIENTE_CONFIRMACION,
      }));
    const porCliente = new Map<string, typeof pedidos>();
    for (const p of pedidos) {
      const l = porCliente.get(p.clienteId) ?? [];
      l.push(p);
      porCliente.set(p.clienteId, l);
    }
    const primerPedido = new Map(
      primeros.map((g) => [g.clienteId, g._min.createdAt]),
    );
    const conMarca = new Set(modificados.map((g) => g.clienteId));
    const nPortal = new Map(porPortal.map((g) => [g.clienteId, g._count._all]));
    const nPanel = new Map(porPanel.map((g) => [g.clienteId, g._count._all]));

    const filasClientes = clientes
      .filter(
        (c) =>
          c.bajaAt === null ||
          (porCliente.get(c.id) ?? []).some((p) => p.semana === seleccionada),
      )
      .map((c) => {
        const suyos = porCliente.get(c.id) ?? [];
        const estado = estadoEnSemana(suyos, seleccionada);
        const vigente = suyos.find(
          (p) => p.semana === seleccionada && !p.cancelado,
        );
        const primero = primerPedido.get(c.id) ?? null;
        return {
          id: c.id,
          nombre: c.nombre,
          codigo: c.codigo,
          estado,
          etapa: etapaActivacion({
            pedidosCliente: suyos,
            seleccionada,
            tienePedidoAlgunaVez: primero !== null,
            ultimoAccesoAt: c.ultimoAccesoAt,
          }),
          ultimoAccesoAt: c.ultimoAccesoAt?.toISOString() ?? null,
          primerPedidoAt: primero?.toISOString() ?? null,
          pedidosUltimas4Semanas: semanasConPedido(suyos, anteriores),
          modificadoSinReconfirmar: conMarca.has(c.id),
          pedidoId: vigente?.id ?? null,
          folio: vigente?.folio ?? null,
          origen: resumenOrigen({
            portal: nPortal.get(c.id) ?? 0,
            panel: nPanel.get(c.id) ?? 0,
          }),
        };
      })
      // Primero los habituales que no han pedido; luego por nombre.
      .sort(
        (a, b) =>
          Number(b.estado === 'NO_HA_PEDIDO_HABITUAL') -
            Number(a.estado === 'NO_HA_PEDIDO_HABITUAL') ||
          a.nombre.localeCompare(b.nombre, 'es'),
      );

    const porEstado = Object.fromEntries(
      ESTADOS_SEMANA.map((e) => [e, 0]),
    ) as Record<EstadoSemana, number>;
    for (const f of filasClientes) porEstado[f.estado]++;

    const nombrePorCliente = new Map(clientes.map((c) => [c.id, c.nombre]));
    const cancelados = filas
      .filter(
        (o) =>
          o.cancelado &&
          o.detalleB2b!.confirmadoAt &&
          aYmd(o.detalleB2b!.semanaInicio) === seleccionada,
      )
      .map((o) => ({
        pedidoId: o.id,
        folio: o.folio,
        cliente:
          nombrePorCliente.get(o.clienteId) ?? o.detalleB2b!.negocioNombre,
        confirmadoAt: o.detalleB2b!.confirmadoAt!.toISOString(),
        canceladoAt: o.canceladoAt?.toISOString() ?? null,
      }))
      .sort((a, b) => a.folio.localeCompare(b.folio));

    return {
      semana: {
        inicio: seleccionada,
        fin: sumarDiasISO(seleccionada, 6),
        esActual: seleccionada === ref.enCurso,
        esProxima: seleccionada === ref.proxima,
        enCurso: ref.enCurso,
        proxima: ref.proxima,
      },
      avisos: this.avisos(),
      resumen: {
        totalClientes: filasClientes.length,
        pidieron: porEstado.PIDIO + porEstado.SIN_CONFIRMAR,
        sinConfirmar: porEstado.SIN_CONFIRMAR,
        habitualesSinPedir: porEstado.NO_HA_PEDIDO_HABITUAL,
        cancelaron: porEstado.CANCELADO,
        porEstado,
      },
      clientes: filasClientes,
      canceladosDespuesDeConfirmar: cancelados,
      origen: resumenOrigen({
        portal: porPortal.reduce((n, g) => n + g._count._all, 0),
        panel: porPanel.reduce((n, g) => n + g._count._all, 0),
      }),
    };
  }

  // ------------------------------------------------------------------ Interno

  async interno() {
    const ahora = new Date();
    const ref = semanasReferencia(ahora);
    const hoy = aFecha(ref.hoy);
    const enCurso = aFecha(ref.enCurso);
    const ventana = aFecha(sumarDiasISO(ref.hoy, -DIAS_VENTANA));
    const hace28 = new Date(ahora.getTime() - DIAS_VENTANA * 86_400_000);

    const vigente = { tipo: TipoOrden.B2B, cancelado: false } as const;
    const sinConfirmarWhere = {
      ...vigente,
      estadoPedido: EstadoPedido.PENDIENTE_CONFIRMACION,
    };
    const pasadasWhere = {
      ...vigente,
      estadoPedido: { notIn: ESTADOS_B2B_COMPLETADOS },
      detalleB2b: { semanaInicio: { lt: enCurso } },
    };
    const atrasadasWhere = {
      estado: EstadoEntrega.PENDIENTE,
      fecha: { lt: hoy },
      order: vigente,
    };
    const seleccionOrden = {
      id: true,
      folio: true,
      estadoPedido: true,
      createdAt: true,
      detalleB2b: { select: { semanaInicio: true, negocioNombre: true } },
    } as const;

    const [
      sinConfirmarTotal,
      sinConfirmar,
      atrasadasTotal,
      atrasadas,
      pasadasTotal,
      pasadas,
      pedidosVentana,
      entregadas,
      noRecogidas,
    ] = await Promise.all([
      this.db.order.count({ where: sinConfirmarWhere }),
      this.db.order.findMany({
        where: sinConfirmarWhere,
        orderBy: { createdAt: 'asc' },
        take: MAX_FILAS,
        select: seleccionOrden,
      }),
      this.db.entrega.count({ where: atrasadasWhere }),
      this.db.entrega.findMany({
        where: atrasadasWhere,
        orderBy: { fecha: 'asc' },
        take: MAX_FILAS,
        select: {
          id: true,
          fecha: true,
          order: {
            select: {
              id: true,
              folio: true,
              detalleB2b: { select: { negocioNombre: true } },
            },
          },
        },
      }),
      this.db.order.count({ where: pasadasWhere }),
      this.db.order.findMany({
        where: pasadasWhere,
        orderBy: { detalleB2b: { semanaInicio: 'asc' } },
        take: MAX_FILAS,
        select: seleccionOrden,
      }),
      this.db.order.findMany({
        where: { tipo: TipoOrden.B2B, createdAt: { gte: hace28 } },
        select: {
          createdAt: true,
          detalleB2b: { select: { confirmadoAt: true } },
        },
      }),
      this.db.entrega.findMany({
        where: {
          estado: EstadoEntrega.ENTREGADA,
          fecha: { gte: ventana, lte: hoy },
        },
        select: { fecha: true, estadoCambiadoAt: true },
      }),
      this.db.entrega.count({
        where: {
          estado: EstadoEntrega.NO_RECOGIDA,
          fecha: { gte: ventana, lte: hoy },
        },
      }),
    ]);

    return {
      hoy: ref.hoy,
      semanaEnCurso: ref.enCurso,
      avisos: this.avisos(),
      sinConfirmar: {
        total: sinConfirmarTotal,
        items: sinConfirmar.map((o) => ({
          pedidoId: o.id,
          folio: o.folio,
          cliente: o.detalleB2b!.negocioNombre,
          semana: aYmd(o.detalleB2b!.semanaInicio),
          recibidoAt: o.createdAt.toISOString(),
          horasEspera: Math.floor(
            (ahora.getTime() - o.createdAt.getTime()) / 3_600_000,
          ),
          deSemanaPasada: aYmd(o.detalleB2b!.semanaInicio) < ref.enCurso,
        })),
      },
      entregasAtrasadas: {
        total: atrasadasTotal,
        items: atrasadas.map((e) => ({
          entregaId: e.id,
          pedidoId: e.order.id,
          folio: e.order.folio,
          cliente: e.order.detalleB2b!.negocioNombre,
          fecha: aYmd(e.fecha),
          diasAtraso: Math.round(
            (hoy.getTime() - e.fecha.getTime()) / 86_400_000,
          ),
        })),
      },
      semanasPasadasSinCompletar: {
        total: pasadasTotal,
        items: pasadas.map((o) => ({
          pedidoId: o.id,
          folio: o.folio,
          cliente: o.detalleB2b!.negocioNombre,
          semana: aYmd(o.detalleB2b!.semanaInicio),
          estado: estadoB2bVisible(o.estadoPedido),
        })),
      },
      tiempos: {
        ventanaDias: DIAS_VENTANA,
        pedidosEnVentana: pedidosVentana.length,
        recibidoAConfirmado: horasRecibidoAConfirmado(
          pedidosVentana.map((o) => ({
            creadoAt: o.createdAt,
            confirmadoAt: o.detalleB2b?.confirmadoAt ?? null,
          })),
        ),
        puntualidad: puntualidadEntregas(entregadas),
        noRecogidas,
      },
    };
  }
}
