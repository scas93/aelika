import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EstadoEntrega, EstadoPedido } from '../../generated/prisma/client';
import { DiaSemana } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { bloquearClienteB2b } from '../pedidos-b2b/pedidos-b2b-crear';
import {
  recalcularEstadoB2b,
  recalcularTotalesB2b,
} from '../pedidos-b2b/pedidos-b2b-estados';
import { sincronizarOrdenB2b } from '../pedidos-b2b/pedidos-b2b-orden';
import {
  resolverItems,
  resolverSemanaYDia,
  sumarDiasISO,
} from '../pedidos-b2b/pedidos-b2b-logica';
import type { SesionValida } from './portal-acceso.service';
import {
  calendarioDeSemana,
  parametrosDe,
  semanaModificable,
} from './portal-modificable';
import { calcularCalendario, semanasDelHorizonte } from './portal-calendario';
import { cargarPedidosCalendario } from './portal-calendario.service';
import { PortalMisPedidosService } from './portal-mis-pedidos.service';

export interface CambioEntregaInput {
  fecha: string;
  items: { productId: string; cantidad: number }[];
}

export interface ModificarPedidoInput {
  entregas: CambioEntregaInput[];
  /** undefined = no tocar; null o vacío = quitar la nota. */
  notaCliente?: string | null;
  /** `updatedAt` del pedido tal como lo cargó el portal. */
  version: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

const FECHA_LARGA = new Intl.DateTimeFormat('es-MX', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const etiqueta = (fechaISO: string) =>
  FECHA_LARGA.format(new Date(`${fechaISO}T00:00:00Z`));

type Problema = { fecha: string; motivo: string; mensaje: string };

function conflicto(
  codigo: string,
  mensaje: string,
  fechas?: Problema[],
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    codigo,
    message: mensaje,
    ...(fechas ? { fechas } : {}),
  });
}

/** Líneas de una entrega: productId → cantidad. */
type Lineas = Map<string, number>;
const iguales = (a: Lineas, b: Lineas) =>
  a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

/**
 * Modificar un pedido desde el portal (4f). Siempre el pedido del cliente de la SESIÓN (404 uniforme si no es suyo).
 * Todo se revalida DENTRO de la transacción, con el cliente y el pedido bloqueados: calendario (36 h / 18 h), pago,
 * versión y reglas del pedido. El servidor nunca confía en precios ni en el estado que mande el cliente.
 */
@Injectable()
export class PortalModificarPedidoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly misPedidos: PortalMisPedidosService,
  ) {}

  private clienteDe(sesion: SesionValida) {
    if (!sesion.cliente)
      throw new ConflictException('Elige un cliente para modificar tu pedido');
    return sesion.cliente;
  }

  private async buscarPedido(sesion: SesionValida, folio: string) {
    const c = this.clienteDe(sesion);
    if (!/^[A-Za-z0-9-]{1,40}$/.test(folio))
      throw new NotFoundException('Pedido no encontrado');
    const fila = await this.prisma.order.findFirst({
      where: {
        tenantId: sesion.tenant.id,
        clienteId: c.id,
        tipo: 'B2B',
        folio,
        detalleB2b: { isNot: null },
      },
      select: { id: true, detalleB2b: { select: { semanaInicio: true } } },
    });
    if (!fila) throw new NotFoundException('Pedido no encontrado');
    return {
      id: fila.id,
      clienteId: c.id,
      semanaISO: iso(fila.detalleB2b!.semanaInicio),
    };
  }

  /**
   * GET /portal/pedidos-modificables: pedidos del cliente en los que hoy se puede cambiar algo (no pagados, con un día
   * modificable o agregable según el calendario de la 4c). Alimenta «Modificar pedido activo».
   */
  async listarModificables(sesion: SesionValida) {
    const c = this.clienteDe(sesion);
    const t = sesion.tenant;
    const ahora = new Date();
    const parametros = parametrosDe(t);
    const inicios = semanasDelHorizonte(ahora, parametros.horizonteSemanas);
    const { porSemana } = await cargarPedidosCalendario(
      this.prisma,
      t.id,
      c.id,
      inicios,
    );
    const folios = calcularCalendario(ahora, parametros, porSemana)
      .filter(semanaModificable)
      .map((s) => s.pedido!.folio);
    return { pedidos: await this.misPedidos.resumenesPorFolio(sesion, folios) };
  }

  /** GET /portal/pedidos/:folio/modificar: lo que la pantalla de modificar necesita (solo lectura). */
  async estado(sesion: SesionValida, folio: string) {
    const { id, clienteId, semanaISO } = await this.buscarPedido(sesion, folio);
    const t = sesion.tenant;
    const orden = await this.prisma.order.findFirstOrThrow({
      where: { id, tenantId: t.id, clienteId },
      include: {
        detalleB2b: true,
        items: { include: { entregaItems: true } },
        entregas: true,
      },
    });
    const d = orden.detalleB2b!;
    const semana = await calendarioDeSemana(
      this.prisma,
      t,
      clienteId,
      semanaISO,
      new Date(),
    );

    let bloqueo: { codigo: string; mensaje: string } | null = null;
    if (orden.cancelado)
      bloqueo = {
        codigo: 'PEDIDO_CANCELADO',
        mensaje: 'Este pedido está cancelado',
      };
    else if (orden.estadoPago === 'PAGADO')
      bloqueo = {
        codigo: 'PEDIDO_PAGADO',
        mensaje:
          'Este pedido ya está pagado y no se puede modificar desde el portal. Contáctanos',
      };
    else if (orden.items.some((i) => i.productId === null))
      bloqueo = {
        codigo: 'PRODUCTO_FUERA_DE_CATALOGO',
        mensaje:
          'Este pedido incluye un producto que ya no está en el catálogo. Contáctanos para modificarlo',
      };
    else if (!semana)
      bloqueo = {
        codigo: 'FUERA_DEL_CALENDARIO',
        mensaje: 'Este pedido ya no se puede modificar desde el portal',
      };

    const lineasDe = (entregaId: string) =>
      [...orden.items]
        .sort((a, b) => a.orden - b.orden)
        .flatMap((i) =>
          i.entregaItems
            .filter((ei) => ei.entregaId === entregaId)
            .map((ei) => ({
              productId: i.productId!,
              nombre: i.nombreProducto,
              cantidad: ei.cantidad,
              precioUnitario: Number(i.precioUnitario),
            })),
        );

    const dias = Array.from({ length: 7 }, (_, i) => {
      const fecha = sumarDiasISO(semanaISO, i);
      const calendario = semana?.dias.find((x) => x.fecha === fecha);
      const entrega = orden.entregas.find(
        (e) => iso(e.fecha) === fecha && e.estado !== EstadoEntrega.CANCELADA,
      );
      return {
        fecha,
        diaSemana: resolverSemanaYDia(fecha).dia,
        // Sin calendario (pedido fuera del horizonte o cancelado) todo queda cerrado/solo lectura.
        estado: calendario?.estado ?? 'CERRADO',
        motivo: calendario?.motivo ?? null,
        limiteAt: calendario?.limiteAt ?? null,
        entrega: entrega
          ? {
              estado: entrega.estado,
              productos: lineasDe(entrega.id),
            }
          : null,
      };
    });

    return {
      folio: orden.folio,
      version: orden.updatedAt.toISOString(),
      semanaInicio: semanaISO,
      semanaFin: sumarDiasISO(semanaISO, 6),
      estadoPedido: orden.cancelado
        ? 'CANCELADO'
        : (orden.estadoPedido as string),
      pagado: orden.estadoPago === 'PAGADO',
      modificadoPorCliente:
        !orden.cancelado && orden.modificadoPorClienteAt !== null,
      bloqueo,
      horasAgregar: t.portalHorasAgregarDia,
      horasModificar: t.portalHorasModificar,
      descuentoPorcentaje: Number(d.descuentoPorcentajeAplicado ?? 0),
      minimoPiezas: d.minimoPiezasAplicado,
      notaCliente: d.notaCliente,
      numeroAtencion: t.numeroAtencion,
      dias,
    };
  }

  /** PATCH /portal/pedidos/:folio. */
  async modificar(
    sesion: SesionValida,
    folio: string,
    dto: ModificarPedidoInput,
  ) {
    const { id, clienteId, semanaISO } = await this.buscarPedido(sesion, folio);
    const t = sesion.tenant;
    const fin = sumarDiasISO(semanaISO, 6);

    // ---- Entrada: fechas únicas y dentro de la semana del pedido; productos repetidos sumados ----
    const deseadas = new Map<string, Lineas>();
    for (const e of dto.entregas) {
      if (e.fecha < semanaISO || e.fecha > fin)
        throw new BadRequestException(
          `El ${etiqueta(e.fecha)} no pertenece a la semana de este pedido`,
        );
      if (deseadas.has(e.fecha))
        throw new BadRequestException(`La fecha ${e.fecha} está repetida`);
      const lineas: Lineas = new Map();
      for (const it of e.items)
        if (it.cantidad > 0)
          lineas.set(
            it.productId,
            (lineas.get(it.productId) ?? 0) + it.cantidad,
          );
      deseadas.set(e.fecha, lineas);
    }

    const resultado = await this.prisma.$transaction(async (tx) => {
      const ahora = new Date();
      // Orden de candados: cliente → pedido (igual que crear); el panel solo toma el del pedido.
      await bloquearClienteB2b(tx, t.id, clienteId);
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${id} FOR UPDATE`;
      const orden = await tx.order.findFirstOrThrow({
        where: { id, tenantId: t.id, clienteId },
        include: {
          detalleB2b: true,
          items: { include: { entregaItems: true } },
          entregas: true,
        },
      });
      const detalle = orden.detalleB2b!;

      // ---- Estado del pedido ----
      if (orden.cancelado)
        throw conflicto('PEDIDO_CANCELADO', 'Este pedido está cancelado');
      if (orden.estadoPago === 'PAGADO')
        throw conflicto(
          'PEDIDO_PAGADO',
          'Este pedido ya está pagado y no se puede modificar desde el portal. Contáctanos',
        );
      if (orden.items.some((i) => i.productId === null))
        throw conflicto(
          'PRODUCTO_FUERA_DE_CATALOGO',
          'Este pedido incluye un producto que ya no está en el catálogo. Contáctanos para modificarlo',
        );
      if (new Date(dto.version).getTime() !== orden.updatedAt.getTime())
        throw conflicto(
          'PEDIDO_CAMBIO',
          'Tu pedido cambió mientras lo editabas. Revísalo y vuelve a intentar',
        );

      // ---- Calendario revalidado con todo bloqueado ----
      const semana = await calendarioDeSemana(
        tx,
        t,
        clienteId,
        semanaISO,
        ahora,
      );
      if (!semana)
        throw conflicto(
          'FUERA_DEL_CALENDARIO',
          'Este pedido ya no se puede modificar desde el portal',
        );

      // ---- Estado actual por fecha (entregas vigentes) ----
      const actual = new Map<string, Lineas>();
      for (const e of orden.entregas) {
        if (e.estado === EstadoEntrega.CANCELADA) continue;
        actual.set(iso(e.fecha), new Map());
      }
      for (const i of orden.items)
        for (const ei of i.entregaItems) {
          const e = orden.entregas.find((x) => x.id === ei.entregaId);
          if (!e || e.estado === EstadoEntrega.CANCELADA) continue;
          actual.get(iso(e.fecha))!.set(i.productId!, ei.cantidad);
        }

      // ---- Qué cambia y si cada cambio está permitido por el calendario ----
      const problemas: Problema[] = [];
      const cambios: string[] = [];
      for (const [fecha, nuevo] of deseadas) {
        const previo = actual.get(fecha) ?? new Map<string, number>();
        if (iguales(previo, nuevo)) continue;
        const dia = semana.dias.find((x) => x.fecha === fecha)!;
        const existe = actual.has(fecha);
        const permitido = existe
          ? dia.estado === 'MODIFICABLE'
          : dia.estado === 'AGREGABLE';
        if (!permitido) {
          problemas.push(this.problemaDia(fecha, dia, existe, t));
          continue;
        }
        cambios.push(fecha);
      }
      if (problemas.length > 0)
        throw conflicto(
          'FECHAS_NO_DISPONIBLES',
          problemas[0].mensaje,
          problemas,
        );

      // ---- Resultado final por fecha ----
      const final = new Map<string, Lineas>();
      for (const [fecha, lineas] of actual) final.set(fecha, new Map(lineas));
      for (const fecha of cambios) {
        const nuevo = deseadas.get(fecha)!;
        if (nuevo.size === 0) final.delete(fecha);
        else final.set(fecha, new Map(nuevo));
      }

      const nota =
        dto.notaCliente === undefined
          ? undefined
          : dto.notaCliente?.trim() || null;
      const notaCambio =
        nota !== undefined && nota !== (detalle.notaCliente ?? null);
      const entregasCambiaron = cambios.length > 0;
      if (!entregasCambiaron && !notaCambio) return null; // nada que guardar

      if (entregasCambiaron && final.size === 0)
        throw conflicto(
          'ULTIMA_ENTREGA',
          'Un pedido debe conservar al menos una entrega. Si quieres cancelarlo, contáctanos',
        );

      // ---- Productos: nuevos o con más cantidad solo si siguen disponibles ----
      const aumentos = new Set<string>();
      for (const fecha of cambios) {
        const previo = actual.get(fecha) ?? new Map<string, number>();
        for (const [productId, cantidad] of deseadas.get(fecha)!)
          if (cantidad > (previo.get(productId) ?? 0)) aumentos.add(productId);
      }
      if (aumentos.size > 0) {
        const disponibles = await tx.product.findMany({
          where: {
            tenantId: t.id,
            disponible: true,
            id: { in: [...aumentos] },
          },
          select: { id: true },
        });
        if (disponibles.length !== aumentos.size) {
          const ok = new Set(disponibles.map((p) => p.id));
          const faltantes = await tx.product.findMany({
            where: {
              tenantId: t.id,
              id: { in: [...aumentos].filter((p) => !ok.has(p)) },
            },
            select: { nombre: true },
          });
          throw conflicto(
            'PRODUCTO_NO_DISPONIBLE',
            faltantes.length
              ? `Ya no está disponible: ${faltantes.map((p) => p.nombre).join(', ')}. Quítalo o reduce su cantidad`
              : 'Alguno de los productos no existe en este negocio',
          );
        }
      }

      let totalPiezas = detalle.totalPiezas;
      if (entregasCambiaron) {
        // Carrito completo de la semana → distribución por día (como el panel).
        const porProducto = new Map<
          string,
          { dia: DiaSemana; cantidad: number }[]
        >();
        // Los productos que ya estaban conservan su posición en el pedido; los nuevos van al final.
        for (const i of [...orden.items].sort((a, b) => a.orden - b.orden))
          if ([...final.values()].some((l) => l.has(i.productId!)))
            porProducto.set(i.productId!, []);
        for (const [fecha, lineas] of [...final].sort((a, b) =>
          a[0].localeCompare(b[0]),
        )) {
          const { dia } = resolverSemanaYDia(fecha);
          for (const [productId, cantidad] of lineas)
            porProducto.set(productId, [
              ...(porProducto.get(productId) ?? []),
              { dia, cantidad },
            ]);
        }
        const r = await resolverItems(
          this.prisma,
          t.id,
          [...porProducto].map(([productId, distribucion]) => ({
            productId,
            distribucion,
          })),
        );
        if (
          detalle.minimoPiezasAplicado > 0 &&
          r.totalPiezas < detalle.minimoPiezasAplicado
        )
          throw conflicto(
            'MINIMO_PIEZAS',
            `El pedido necesita al menos ${detalle.minimoPiezasAplicado} piezas (llevas ${r.totalPiezas})`,
          );
        totalPiezas = r.totalPiezas;
        // Todas las líneas toman el precio actual del catálogo (regla del documento para pedidos editados).
        await sincronizarOrdenB2b(
          tx,
          t.id,
          id,
          detalle.semanaInicio,
          r.resueltos,
        );
      }

      await tx.detalleB2B.update({
        where: { orderId: id },
        data: {
          totalPiezas,
          ...(notaCambio ? { notaCliente: nota } : {}),
        },
      });
      if (entregasCambiaron) await recalcularTotalesB2b(tx, id);

      // Confirmado vuelve a Por confirmar solo si cambiaron entregas (la nota sola no regresa el estado). El pago no se toca.
      await tx.order.update({
        where: { id },
        data: {
          modificadoPorClienteAt: ahora,
          ...(entregasCambiaron &&
          orden.estadoPedido === EstadoPedido.CONFIRMADO_SURTIENDO
            ? { estadoPedido: EstadoPedido.PENDIENTE_CONFIRMACION }
            : {}),
        },
      });
      // En proceso conserva su estado salvo que el cálculo por entregas cambie (p. ej. Completado + día nuevo → En proceso).
      if (entregasCambiaron) await recalcularEstadoB2b(tx, id);
      return { cambios: cambios.length, notaCambio };
    });

    const detalle = await this.misPedidos.detalle(sesion, folio);
    return {
      cambio: resultado !== null,
      pedido: detalle,
    };
  }

  private problemaDia(
    fecha: string,
    dia: {
      estado: string;
      motivo: string | null;
    },
    existe: boolean,
    t: { portalHorasAgregarDia: number; portalHorasModificar: number },
  ): Problema {
    const f = etiqueta(fecha);
    switch (dia.motivo) {
      case 'ENTREGA_CERRADA':
        return {
          fecha,
          motivo: 'ENTREGA_CERRADA',
          mensaje: `La entrega del ${f} ya está cerrada y no se puede cambiar`,
        };
      case 'ANTICIPACION_MODIFICAR':
        return {
          fecha,
          motivo: 'ANTICIPACION_MODIFICAR',
          mensaje: `El ${f} ya no se puede modificar: se necesitan al menos ${t.portalHorasModificar} horas de anticipación`,
        };
      case 'ANTICIPACION_AGREGAR':
        return {
          fecha,
          motivo: 'ANTICIPACION_AGREGAR',
          mensaje: `El ${f} ya no se puede agregar: se necesitan al menos ${t.portalHorasAgregarDia} horas de anticipación`,
        };
      case 'PASADO':
        return { fecha, motivo: 'PASADO', mensaje: `El ${f} ya pasó` };
      case 'PEDIDO_PAGADO':
        return {
          fecha,
          motivo: 'PEDIDO_PAGADO',
          mensaje:
            'Este pedido ya está pagado y no se puede modificar desde el portal',
        };
      default:
        return {
          fecha,
          motivo: existe ? 'NO_MODIFICABLE' : 'NO_DISPONIBLE',
          mensaje: `El ${f} no está disponible`,
        };
    }
  }
}
