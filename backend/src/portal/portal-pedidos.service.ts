import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DiaSemana, OrigenPedidoB2b } from '../../generated/prisma/enums';
import { CODIGOS_STORE } from './codigos-store';
import type { CodigosStore } from './codigos-store';
import type { SesionValida } from './portal-acceso.service';
import { calcularCalendario } from './portal-calendario';
import { cargarPedidosCalendario } from './portal-calendario.service';
import {
  bloquearClienteB2b,
  crearPedidoB2bDeCliente,
} from '../pedidos-b2b/pedidos-b2b-crear';
import {
  resolverItems,
  resolverSemanaYDia,
  sumarDiasISO,
} from '../pedidos-b2b/pedidos-b2b-logica';
import { round2 } from '../common/money';

export interface EntregaPortalInput {
  fecha: string;
  items: { productId: string; cantidad: number }[];
}

const MENSAJE_YA_TIENE_PEDIDO =
  'Ya tienes pedido para esta semana. Para agregar o cambiar entregas, usa Modificar pedido activo';

const FECHA_LARGA = new Intl.DateTimeFormat('es-MX', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});
const etiqueta = (fechaISO: string) =>
  FECHA_LARGA.format(new Date(`${fechaISO}T00:00:00Z`));

export interface ResultadoPedidoPortal {
  pedidos: {
    folio: string;
    semanaInicio: string;
    semanaFin: string;
    estado: 'PENDIENTE_CONFIRMACION';
    totalPiezas: number;
    subtotal: number;
    descuentoPorcentaje: number;
    descuentoTotal: number;
    total: number;
    entregas: {
      fecha: string;
      productos: {
        nombre: string;
        cantidad: number;
        precioUnitario: number;
        subtotal: number;
      }[];
    }[];
  }[];
  total: number;
}

/**
 * POST /portal/pedidos (4d): crea el pedido (o los dos, uno por semana) del cliente de la SESIÓN — nunca del cuerpo —
 * en una sola transacción: todo o nada. Revalida cada fecha con el calendario de la 4c DENTRO de la transacción, con el
 * cliente bloqueado, así que dos envíos simultáneos no pueden crear dos pedidos de la misma semana.
 * No dispara notificaciones: el pedido nace Por confirmar y solo «Confirmado» avisa (decisión de diseño).
 */
@Injectable()
export class PortalPedidosService {
  private readonly logger = new Logger(PortalPedidosService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CODIGOS_STORE) private readonly store: CodigosStore,
  ) {}

  async crear(
    sesion: SesionValida,
    entregas: EntregaPortalInput[],
    notaCliente: string | undefined,
    idemKey?: string,
  ) {
    if (!sesion.cliente)
      throw new ConflictException('Elige un cliente antes de crear un pedido');
    const clave = idemKey
      ? `portal:idem:${sesion.tenant.id}:${sesion.cliente.id}:${idemKey}`
      : null;

    // Idempotencia: el mismo envío (doble clic, reintento) devuelve el mismo resultado y no duplica. Si Redis no
    // responde se sigue sin ella: la regla «un pedido por semana» bajo el candado del cliente igual evita duplicados.
    let reservada = false;
    if (clave) {
      try {
        reservada = await this.store.reservar(clave, 'EN_CURSO', 120);
        if (!reservada) {
          const previo = await this.store.leer(clave);
          if (previo && previo !== 'EN_CURSO')
            return JSON.parse(previo) as ResultadoPedidoPortal;
          throw new ConflictException(
            'Tu pedido se está procesando. Espera un momento',
          );
        }
      } catch (e) {
        if (e instanceof HttpException) throw e;
        this.logger.warn(`Idempotencia no disponible (Redis): ${String(e)}`);
      }
    }

    try {
      const resultado = await this.crearEnTransaccion(
        sesion,
        entregas,
        notaCliente,
      );
      if (clave && reservada) {
        await this.store
          .escribir(clave, JSON.stringify(resultado), 24 * 3600)
          .catch((e: unknown) =>
            this.logger.warn(
              `No se pudo guardar la idempotencia: ${String(e)}`,
            ),
          );
      }
      return resultado;
    } catch (e) {
      if (clave && reservada)
        await this.store.borrar(clave).catch(() => undefined);
      throw e;
    }
  }

  private async crearEnTransaccion(
    sesion: SesionValida,
    entregas: EntregaPortalInput[],
    notaCliente: string | undefined,
  ): Promise<ResultadoPedidoPortal> {
    const t = sesion.tenant;
    const clienteId = sesion.cliente!.id;

    // ---- Entrada: fechas únicas, cantidades > 0, productos repetidos sumados ----
    const porFecha = new Map<string, Map<string, number>>();
    for (const e of entregas) {
      if (porFecha.has(e.fecha))
        throw new BadRequestException(`La fecha ${e.fecha} está repetida`);
      const productos = new Map<string, number>();
      for (const it of e.items) {
        if (it.cantidad > 0)
          productos.set(
            it.productId,
            (productos.get(it.productId) ?? 0) + it.cantidad,
          );
      }
      if (productos.size === 0) {
        throw new BadRequestException(
          `La entrega del ${etiqueta(e.fecha)} no tiene ningún producto`,
        );
      }
      porFecha.set(e.fecha, productos);
    }

    // ---- Productos: solo los disponibles de este negocio (el servidor pone nombre y precio) ----
    const ids = [
      ...new Set([...porFecha.values()].flatMap((m) => [...m.keys()])),
    ];
    const disponibles = await this.prisma.product.findMany({
      where: { tenantId: t.id, disponible: true, id: { in: ids } },
      select: { id: true },
    });
    if (disponibles.length !== ids.length) {
      throw new ConflictException(
        'Alguno de los productos ya no está disponible. Actualiza el catálogo y revisa tu pedido',
      );
    }

    // ---- Agrupar por semana ----
    const semanas = new Map<string, { fecha: string; dia: DiaSemana }[]>();
    for (const fecha of [...porFecha.keys()].sort()) {
      const { semanaInicio, dia } = resolverSemanaYDia(fecha);
      const clave = semanaInicio.toISOString().slice(0, 10);
      semanas.set(clave, [...(semanas.get(clave) ?? []), { fecha, dia }]);
    }

    const parametros = {
      horaEntrega: t.portalHoraEntrega,
      horasAgregar: t.portalHorasAgregarDia,
      horasModificar: t.portalHorasModificar,
      horizonteSemanas: t.portalHorizonteSemanas,
    };

    return this.prisma.$transaction(async (tx) => {
      const ahora = new Date();
      const { cliente, principal } = await bloquearClienteB2b(
        tx,
        t.id,
        clienteId,
      );

      // ---- Calendario revalidado con el cliente bloqueado ----
      const inicios = [...semanas.keys()].sort();
      const { porSemana } = await cargarPedidosCalendario(
        tx,
        t.id,
        clienteId,
        inicios,
      );
      const calendario = calcularCalendario(ahora, parametros, porSemana);
      const diasCalendario = new Map(
        calendario.flatMap((s) =>
          s.dias.map((d) => [d.fecha, { dia: d, semana: s }]),
        ),
      );

      const problemas: { fecha: string; motivo: string; mensaje: string }[] =
        [];
      for (const fecha of porFecha.keys()) {
        const info = diasCalendario.get(fecha);
        if (!info) {
          problemas.push({
            fecha,
            motivo: 'FUERA_DEL_CALENDARIO',
            mensaje: `El ${etiqueta(fecha)} está fuera de las semanas que puedes pedir`,
          });
          continue;
        }
        const { dia, semana } = info;
        if (semana.pedido) {
          problemas.push({
            fecha,
            motivo: 'SEMANA_CON_PEDIDO',
            mensaje: MENSAJE_YA_TIENE_PEDIDO,
          });
        } else if (dia.estado === 'NO_DISPONIBLE' && dia.motivo === 'PASADO') {
          problemas.push({
            fecha,
            motivo: 'PASADO',
            mensaje: `El ${etiqueta(fecha)} ya pasó`,
          });
        } else if (dia.estado === 'NO_DISPONIBLE') {
          problemas.push({
            fecha,
            motivo: 'ANTICIPACION_AGREGAR',
            mensaje: `El ${etiqueta(fecha)} ya no se puede pedir: se necesitan al menos ${t.portalHorasAgregarDia} horas de anticipación`,
          });
        } else if (
          dia.estado !== 'AGREGABLE' ||
          dia.accion !== 'CREAR_PEDIDO'
        ) {
          problemas.push({
            fecha,
            motivo: 'NO_DISPONIBLE',
            mensaje: `El ${etiqueta(fecha)} no está disponible`,
          });
        }
      }
      if (problemas.length > 0) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: problemas[0].mensaje,
          fechas: problemas,
        });
      }

      // ---- Un pedido por semana, en orden: los folios salen consecutivos ----
      const pedidos: ResultadoPedidoPortal['pedidos'] = [];
      for (const semanaInicioISO of inicios) {
        const dias = semanas.get(semanaInicioISO)!;
        // Carrito de la semana → distribución por día de la semana (como el panel).
        const porProducto = new Map<
          string,
          { dia: DiaSemana; cantidad: number }[]
        >();
        for (const { fecha, dia } of dias) {
          for (const [productId, cantidad] of porFecha.get(fecha)!) {
            porProducto.set(productId, [
              ...(porProducto.get(productId) ?? []),
              { dia, cantidad },
            ]);
          }
        }
        const { resueltos, totalPiezas, subtotal } = await resolverItems(
          this.prisma,
          t.id,
          [...porProducto].map(([productId, distribucion]) => ({
            productId,
            distribucion,
          })),
        );

        if (
          t.pedidoB2bMinimoPiezas > 0 &&
          totalPiezas < t.pedidoB2bMinimoPiezas
        ) {
          throw new ConflictException(
            `El pedido de la semana del ${etiqueta(semanaInicioISO)} necesita al menos ${t.pedidoB2bMinimoPiezas} piezas (llevas ${totalPiezas})`,
          );
        }

        const creado = await crearPedidoB2bDeCliente(tx, {
          origen: OrigenPedidoB2b.PORTAL_CLIENTE,
          tenantId: t.id,
          tenant: {
            pedidoB2bMinimoPiezas: t.pedidoB2bMinimoPiezas,
          },
          cliente,
          principal,
          semanaInicio: new Date(`${semanaInicioISO}T00:00:00.000Z`),
          resueltos,
          totalPiezas,
          subtotal,
          notaCliente,
          mensajeExistente: () => MENSAJE_YA_TIENE_PEDIDO,
        });

        pedidos.push({
          folio: creado.folio,
          semanaInicio: semanaInicioISO,
          semanaFin: sumarDiasISO(semanaInicioISO, 6),
          estado: 'PENDIENTE_CONFIRMACION',
          totalPiezas,
          subtotal: creado.subtotal,
          descuentoPorcentaje: creado.descuentoPorcentaje ?? 0,
          descuentoTotal: creado.descuentoTotal,
          total: creado.total,
          entregas: dias.map(({ fecha, dia }) => ({
            fecha,
            productos: resueltos
              .map((r) => {
                const cantidad =
                  r.distribucion.find((d) => d.dia === dia)?.cantidad ?? 0;
                return {
                  nombre: r.nombreProducto,
                  cantidad,
                  precioUnitario: Number(r.precioUnitario),
                  subtotal: round2(Number(r.precioUnitario) * cantidad),
                };
              })
              .filter((p) => p.cantidad > 0),
          })),
        });
      }

      return {
        pedidos,
        total: round2(pedidos.reduce((s, p) => s + p.total, 0)),
      };
    });
  }
}
