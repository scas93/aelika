import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { libroPedidos } from '../pedidos-b2b/pedidos-b2b-excel';
import {
  buildWherePedidosB2b,
  filasExcelDePedidos,
  PEDIDOS_EXPORT_ORDEN,
  PEDIDOS_EXPORT_SELECT,
} from '../pedidos-b2b/pedidos-b2b-export';
import { construirCorreoCliente } from './resumen-semanal-cliente';
import {
  calcularTotales,
  construirCorreoResumen,
  nombreArchivoResumen,
  type CorreoResumen,
  type SemanaResumen,
  type TotalesResumen,
} from './resumen-semanal';

export interface ResumenArmado {
  correo: CorreoResumen;
  totales: TotalesResumen;
  /** El Excel de la semana; ausente si no hubo pedidos (el correo corto va sin adjunto). */
  adjunto?: { nombreArchivo: string; contenido: Buffer };
}

/**
 * Arma el contenido del resumen semanal de UN negocio de mayoreo, sin sesión de usuario: `PrismaService` con `tenantId`
 * explícito (el mismo principio que `NotificacionesProcessor`). El criterio de qué pedidos entran (`buildWherePedidosB2b`), las
 * filas y las columnas del Excel (vista HISTORICOS) son EXACTAMENTE las del export del panel (`pedidos-b2b-export.ts`).
 */
@Injectable()
export class ResumenSemanalArmadoService {
  constructor(private readonly prisma: PrismaService) {}

  async armar(
    tenantId: string,
    negocioNombre: string,
    semana: SemanaResumen,
  ): Promise<ResumenArmado> {
    const pedidos = await this.prisma.order.findMany({
      // Pedidos cuya semana (lunes) es la semana pedida, con TODAS sus entregas (caigan en el día que caigan) y sin filtrar
      // cancelados (salen marcados «Cancelado», como en Históricos). `tenantId` siempre explícito.
      where: {
        ...buildWherePedidosB2b({ desde: semana.inicio, hasta: semana.inicio }),
        tenantId,
      },
      orderBy: PEDIDOS_EXPORT_ORDEN,
      select: PEDIDOS_EXPORT_SELECT,
    });
    const { filas, entregas } = filasExcelDePedidos(pedidos);
    const totales = calcularTotales(filas);
    const correo = construirCorreoResumen(negocioNombre, semana, totales);
    if (!totales.hayPedidos) return { correo, totales };
    const contenido = await libroPedidos(filas, entregas, 'HISTORICOS');
    return {
      correo,
      totales,
      adjunto: {
        nombreArchivo: nombreArchivoResumen(negocioNombre, semana),
        contenido,
      },
    };
  }

  /**
   * Arma el resumen de UN cliente B2B (el que recibe el propio cliente): solo sus pedidos de la semana, seleccionados por
   * `clienteId` (nunca por nombre comercial), con el Excel de la vista CLIENTE (sin pago ni descuento). `null` si el cliente no
   * tuvo ningún pedido esa semana (ni cancelado): no hay nada que mandar.
   */
  async armarParaCliente(
    tenantId: string,
    clienteId: string,
    clienteNombre: string,
    negocioNombre: string,
    semana: SemanaResumen,
  ): Promise<ResumenArmado | null> {
    const pedidos = await this.prisma.order.findMany({
      where: {
        ...buildWherePedidosB2b({
          desde: semana.inicio,
          hasta: semana.inicio,
          clienteId,
        }),
        tenantId,
      },
      orderBy: PEDIDOS_EXPORT_ORDEN,
      select: PEDIDOS_EXPORT_SELECT,
    });
    if (pedidos.length === 0) return null;
    const { filas, entregas } = filasExcelDePedidos(pedidos);
    const totales = calcularTotales(filas);
    const correo = construirCorreoCliente(
      negocioNombre,
      clienteNombre,
      semana,
      totales,
      filas,
      entregas,
    );
    const contenido = await libroPedidos(filas, entregas, 'CLIENTE');
    return {
      correo,
      totales,
      adjunto: {
        nombreArchivo: nombreArchivoResumen(negocioNombre, semana),
        contenido,
      },
    };
  }
}
