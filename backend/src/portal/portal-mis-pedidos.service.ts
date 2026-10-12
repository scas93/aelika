import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { round2 } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { diaDeFecha } from '../pedidos-b2b/pedidos-b2b-orden';
import {
  ESTADOS_B2B_ACTIVOS,
  ESTADOS_B2B_COMPLETADOS,
  estadoB2bVisible,
} from '../pedidos-b2b/pedidos-b2b-estados';
import { sumarDiasISO } from '../pedidos-b2b/pedidos-b2b-logica';
import { PortalFavoritoService } from './portal-favorito.service';
import { calendarioDeSemana, semanaModificable } from './portal-modificable';
import type { SesionValida } from './portal-acceso.service';

export const TAMANO_PAGINA_ANTERIORES = 20;
const FOLIO_VALIDO = /^[A-Za-z0-9-]{1,40}$/;

const ETIQUETA_ESTADO: Record<string, string> = {
  PENDIENTE_CONFIRMACION: 'Por confirmar',
  CONFIRMADO_SURTIENDO: 'Confirmado',
  EN_PROCESO: 'En proceso',
  COMPLETADO: 'Completado',
  CANCELADO: 'Cancelado',
};

const ETIQUETA_ENTREGA: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  LISTA: 'Lista',
  ENTREGADA: 'Entregada',
  NO_RECOGIDA: 'No recogida',
  CANCELADA: 'Cancelada',
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | number | null | undefined) =>
  d === null || d === undefined ? 0 : Number(d);

// Lo único que se lee de la base para el portal: lista blanca explícita. Nada de usuarios del equipo, notas internas
// (`Entrega.nota`), hora/destino de la entrega, factura, códigos de descuento, ids internos ni datos de contacto.
const SELECT_PEDIDO = {
  folio: true,
  estadoPedido: true,
  estadoPago: true,
  cancelado: true,
  updatedAt: true,
  modificadoPorClienteAt: true,
  descuentoTotal: true,
  total: true,
  detalleB2b: {
    select: {
      semanaInicio: true,
      totalPiezas: true,
      subtotal: true,
      descuentoPorcentajeAplicado: true,
      pagadoAt: true,
      notaCliente: true,
    },
  },
} satisfies Prisma.OrderSelect;

const SELECT_DETALLE = {
  ...SELECT_PEDIDO,
  entregas: {
    orderBy: { fecha: 'asc' as const },
    select: {
      fecha: true,
      estado: true,
      items: {
        select: {
          cantidad: true,
          orderItem: {
            select: {
              productId: true,
              nombreProducto: true,
              precioUnitario: true,
              orden: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.OrderSelect;

type FilaResumen = Prisma.OrderGetPayload<{ select: typeof SELECT_PEDIDO }>;
type FilaDetalle = Prisma.OrderGetPayload<{ select: typeof SELECT_DETALLE }>;

export interface ResumenPedidoPortal {
  folio: string;
  semanaInicio: string;
  semanaFin: string;
  estado: { codigo: string; etiqueta: string };
  pago: {
    estado: 'PENDIENTE' | 'PAGADO';
    etiqueta: string;
    pagadoAt: string | null;
  };
  /** Marca «Modificado por el cliente»: se enciende al modificar desde el portal y se apaga al reconfirmar o al revisarla el equipo. */
  modificadoPorCliente: boolean;
  totalPiezas: number;
  total: number;
}

function estadoDe(f: Pick<FilaResumen, 'estadoPedido' | 'cancelado'>) {
  const codigo = f.cancelado
    ? 'CANCELADO'
    : (estadoB2bVisible(f.estadoPedido) as string);
  return { codigo, etiqueta: ETIQUETA_ESTADO[codigo] ?? codigo };
}

function resumen(f: FilaResumen): ResumenPedidoPortal {
  const d = f.detalleB2b!;
  const semanaInicio = iso(d.semanaInicio);
  const pagado = f.estadoPago === 'PAGADO';
  return {
    folio: f.folio,
    semanaInicio,
    semanaFin: sumarDiasISO(semanaInicio, 6),
    estado: estadoDe(f),
    pago: {
      estado: pagado ? 'PAGADO' : 'PENDIENTE',
      etiqueta: pagado ? 'Pagado' : 'Pago pendiente',
      pagadoAt: pagado && d.pagadoAt ? d.pagadoAt.toISOString() : null,
    },
    modificadoPorCliente: !f.cancelado && f.modificadoPorClienteAt !== null,
    totalPiezas: d.totalPiezas,
    total: num(f.total),
  };
}

/**
 * «Ver mis pedidos» del portal (4e): solo lectura, siempre del cliente de la SESIÓN. Todas las consultas filtran por
 * tenant + cliente + tipo B2B, así que un folio de otro cliente, de otro negocio o B2C es indistinguible de uno
 * inexistente (404 genérico).
 */
@Injectable()
export class PortalMisPedidosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly favorito: PortalFavoritoService,
  ) {}

  private clienteDe(sesion: SesionValida) {
    if (!sesion.cliente)
      throw new ConflictException('Elige un cliente para ver tus pedidos');
    return sesion.cliente;
  }

  async listar(sesion: SesionValida, cursor?: string) {
    const c = this.clienteDe(sesion);
    const base: Prisma.OrderWhereInput = {
      tenantId: sesion.tenant.id,
      clienteId: c.id,
      tipo: 'B2B',
      detalleB2b: { isNot: null },
    };
    const ORDEN: Prisma.OrderOrderByWithRelationInput[] = [
      { detalleB2b: { semanaInicio: 'desc' } },
      { folio: 'desc' },
    ];
    const offset = this.leerCursor(cursor);

    // Activos: todos (como máximo uno por semana del horizonte). Solo en la primera página.
    const activos =
      offset === 0
        ? await this.prisma.order.findMany({
            where: {
              ...base,
              cancelado: false,
              estadoPedido: { in: ESTADOS_B2B_ACTIVOS },
            },
            orderBy: ORDEN,
            select: SELECT_PEDIDO,
          })
        : [];

    const anteriores = await this.prisma.order.findMany({
      where: {
        ...base,
        OR: [
          { cancelado: true },
          { estadoPedido: { in: ESTADOS_B2B_COMPLETADOS } },
        ],
      },
      orderBy: ORDEN,
      skip: offset,
      take: TAMANO_PAGINA_ANTERIORES + 1,
      select: SELECT_PEDIDO,
    });
    const hayMas = anteriores.length > TAMANO_PAGINA_ANTERIORES;
    return {
      activos: activos.map(resumen),
      anteriores: anteriores.slice(0, TAMANO_PAGINA_ANTERIORES).map(resumen),
      siguienteCursor: hayMas
        ? String(offset + TAMANO_PAGINA_ANTERIORES)
        : null,
    };
  }

  /** Resúmenes de los pedidos (del cliente de la sesión) con esos folios, de la semana más reciente a la más antigua. */
  async resumenesPorFolio(
    sesion: SesionValida,
    folios: string[],
  ): Promise<ResumenPedidoPortal[]> {
    const c = this.clienteDe(sesion);
    if (folios.length === 0) return [];
    const filas = await this.prisma.order.findMany({
      where: {
        tenantId: sesion.tenant.id,
        clienteId: c.id,
        tipo: 'B2B',
        folio: { in: folios },
        detalleB2b: { isNot: null },
      },
      orderBy: [{ detalleB2b: { semanaInicio: 'desc' } }, { folio: 'desc' }],
      select: SELECT_PEDIDO,
    });
    return filas.map(resumen);
  }

  private leerCursor(cursor?: string): number {
    if (cursor === undefined || cursor === '') return 0;
    if (!/^\d{1,6}$/.test(cursor))
      throw new NotFoundException('Pedido no encontrado');
    return Number(cursor);
  }

  private async cargar(
    sesion: SesionValida,
    folio: string,
  ): Promise<FilaDetalle> {
    const c = this.clienteDe(sesion);
    if (!FOLIO_VALIDO.test(folio))
      throw new NotFoundException('Pedido no encontrado');
    const fila = await this.prisma.order.findFirst({
      where: {
        tenantId: sesion.tenant.id,
        clienteId: c.id,
        tipo: 'B2B',
        folio,
        detalleB2b: { isNot: null },
      },
      select: SELECT_DETALLE,
    });
    if (!fila) throw new NotFoundException('Pedido no encontrado');
    return fila;
  }

  /** Plantilla por día de la semana del pedido, sin precios (la forma del favorito). Entregas canceladas no cuentan. */
  private lineasDeFavorito(f: FilaDetalle) {
    const semana = f.detalleB2b!.semanaInicio;
    const porProducto = new Map<
      string,
      { nombre: string; dias: Record<string, number> }
    >();
    const sinProducto: string[] = [];
    for (const e of f.entregas) {
      if (e.estado === 'CANCELADA') continue;
      const dia = diaDeFecha(e.fecha, semana);
      // Orden estable (posición del ítem en el pedido): el favorito no depende del orden en que devuelva la base.
      const items = [...e.items].sort(
        (a, b) => a.orderItem.orden - b.orderItem.orden,
      );
      for (const it of items) {
        const { productId, nombreProducto } = it.orderItem;
        if (!productId) {
          if (!sinProducto.includes(nombreProducto))
            sinProducto.push(nombreProducto);
          continue;
        }
        const l = porProducto.get(productId) ?? {
          nombre: nombreProducto,
          dias: {},
        };
        l.dias[dia] = (l.dias[dia] ?? 0) + it.cantidad;
        porProducto.set(productId, l);
      }
    }
    return { porProducto, sinProducto };
  }

  async detalle(sesion: SesionValida, folio: string) {
    const f = await this.cargar(sesion, folio);
    const d = f.detalleB2b!;
    const entregas = f.entregas.map((e) => ({
      fecha: iso(e.fecha),
      estado: {
        codigo: e.estado,
        etiqueta: ETIQUETA_ENTREGA[e.estado] ?? e.estado,
      },
      productos: [...e.items]
        .sort((a, b) => a.orderItem.orden - b.orderItem.orden)
        .map((it) => ({
          nombre: it.orderItem.nombreProducto,
          cantidad: it.cantidad,
          precioUnitario: num(it.orderItem.precioUnitario),
          subtotal: round2(num(it.orderItem.precioUnitario) * it.cantidad),
        })),
    }));

    // ¿Es su favorito? Mismo contenido (productos y cantidades por día) que el favorito guardado.
    const { porProducto } = this.lineasDeFavorito(f);
    const actual = await this.favorito.leerCrudo(sesion);
    const esFavorito =
      !!actual &&
      actual.length === porProducto.size &&
      actual.every((l) => {
        const o = porProducto.get(l.productId);
        if (!o) return false;
        const a = Object.entries(l.dias).filter(([, v]) => (v ?? 0) > 0);
        const b = Object.entries(o.dias);
        return (
          a.length === b.length && a.every(([k, v]) => o.dias[k] === Number(v))
        );
      });

    return {
      ...resumen(f),
      entregas,
      subtotal: num(d.subtotal),
      descuentoPorcentaje: num(d.descuentoPorcentajeAplicado),
      descuentoTotal: num(f.descuentoTotal),
      notaCliente: d.notaCliente,
      esFavorito,
      // Versión para el control de concurrencia al modificar (el `updatedAt` del pedido).
      version: f.updatedAt.toISOString(),
      // ¿Hay algo que el cliente pueda cambiar ahora? (misma fuente que el calendario de la 4c).
      modificable: semanaModificable(
        f.cancelado
          ? null
          : await calendarioDeSemana(
              this.prisma,
              sesion.tenant,
              sesion.cliente!.id,
              d.semanaInicio.toISOString().slice(0, 10),
              new Date(),
            ),
      ),
    };
  }

  /** «Usar este pedido como favorito»: reemplaza el favorito del cliente (uno por cliente) con las líneas del pedido. */
  async usarComoFavorito(sesion: SesionValida, folio: string) {
    const f = await this.cargar(sesion, folio);
    const { porProducto, sinProducto } = this.lineasDeFavorito(f);

    const vigentes = await this.prisma.product.findMany({
      where: {
        tenantId: sesion.tenant.id,
        disponible: true,
        id: { in: [...porProducto.keys()] },
      },
      select: { id: true },
    });
    const vivos = new Set(vigentes.map((p) => p.id));
    const omitidos = [...sinProducto];
    const lineas: { productId: string; dias: Record<string, number> }[] = [];
    for (const [productId, l] of porProducto) {
      if (vivos.has(productId)) lineas.push({ productId, dias: l.dias });
      else omitidos.push(l.nombre);
    }
    if (lineas.length === 0)
      throw new ConflictException(
        'Los productos de este pedido ya no están disponibles, así que no se puede usar como favorito',
      );
    const r = await this.favorito.guardar(sesion, lineas);
    return { favorito: r.favorito, omitidos };
  }
}
