import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ESTADOS_B2B_ACTIVOS,
  estadoB2bVisible,
} from '../pedidos-b2b/pedidos-b2b-estados';
import type { SesionValida } from './portal-acceso.service';
import {
  ZONA_HORARIA,
  calcularCalendario,
  pedidoEstaActivo,
  semanasDelHorizonte,
  type PedidoSemanaCalendario,
} from './portal-calendario';

const aFecha = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Pedidos del cliente que alimentan el calendario: solo de ESTE cliente y ESTE negocio, no cancelados (un pedido cancelado
 * no cuenta). Además de las semanas pedidas se traen los activos de semanas anteriores, que cuentan para `pedidosActivos`.
 * Sirve tanto para leer el calendario como para revalidarlo DENTRO de la transacción de creación (con el cliente bloqueado).
 */
export async function cargarPedidosCalendario(
  db: PrismaService | Prisma.TransactionClient,
  tenantId: string,
  clienteId: string,
  inicios: string[],
) {
  const pedidos = await db.order.findMany({
    where: {
      tenantId,
      clienteId,
      tipo: 'B2B',
      cancelado: false,
      OR: [
        {
          detalleB2b: {
            semanaInicio: {
              in: inicios.map((i) => new Date(`${i}T00:00:00.000Z`)),
            },
          },
        },
        { estadoPedido: { in: ESTADOS_B2B_ACTIVOS } },
      ],
    },
    select: {
      folio: true,
      estadoPedido: true,
      estadoPago: true,
      detalleB2b: { select: { semanaInicio: true } },
      entregas: { select: { fecha: true, estado: true } },
    },
  });

  const porSemana = new Map<string, PedidoSemanaCalendario>();
  let activos = 0;
  for (const p of pedidos) {
    if (!p.detalleB2b) continue;
    const estado = estadoB2bVisible(p.estadoPedido);
    if (pedidoEstaActivo(estado)) activos += 1;
    porSemana.set(aFecha(p.detalleB2b.semanaInicio), {
      folio: p.folio,
      estadoPedido: estado,
      pagado: p.estadoPago === 'PAGADO',
      entregas: p.entregas.map((e) => ({
        fecha: aFecha(e.fecha),
        estado: e.estado,
      })),
    });
  }
  return { porSemana, activos };
}

/** GET /portal/calendario: qué puede hacer el cliente activo con cada día de entrega (solo lectura). */
@Injectable()
export class PortalCalendarioService {
  constructor(private readonly prisma: PrismaService) {}

  async calendario(sesion: SesionValida) {
    if (!sesion.cliente)
      throw new ConflictException('Elige un cliente para ver tu calendario');
    const t = sesion.tenant;
    const ahora = new Date();
    const parametros = {
      horaEntrega: t.portalHoraEntrega,
      horasAgregar: t.portalHorasAgregarDia,
      horasModificar: t.portalHorasModificar,
      horizonteSemanas: t.portalHorizonteSemanas,
    };
    const inicios = semanasDelHorizonte(ahora, parametros.horizonteSemanas);

    const { porSemana, activos } = await cargarPedidosCalendario(
      this.prisma,
      t.id,
      sesion.cliente.id,
      inicios,
    );

    return {
      ahora: ahora.toISOString(),
      zonaHoraria: ZONA_HORARIA,
      horaEntrega: parametros.horaEntrega,
      horasAgregar: parametros.horasAgregar,
      horasModificar: parametros.horasModificar,
      horizonteSemanas: parametros.horizonteSemanas,
      // Contacto del negocio ya normalizado a 10 dígitos (null = sin botón «Contactar al negocio»).
      numeroAtencion: t.numeroAtencion,
      cliente: sesion.cliente,
      pedidosActivos: activos,
      // Sin tope aparte: una semana por pedido, así que el máximo es el número de semanas del horizonte.
      maximoActivos: inicios.length,
      semanas: calcularCalendario(ahora, parametros, porSemana),
    };
  }
}
