import { BadRequestException, Injectable } from '@nestjs/common';
import { Cliente, Prisma } from '../../generated/prisma/client';
import { ReglaFiltroCampo, ReglaFiltroOperador } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { FiltroCondicion } from './filtro-condicion.type';

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Evalúa el Filtro de una Regla (lista de condiciones sobre Cliente,
 * combinadas con Y) y devuelve los Cliente que las cumplen todas.
 *
 * Recibe `tenantId` explícito en vez de depender de TenantPrismaService
 * (que resuelve el tenant desde la sesión JWT): este servicio se llama
 * tanto desde el panel (con sesión) como, en la Etapa 2, desde un job
 * periódico sin sesión — mismo patrón que PublicService/
 * NotificacionesProcessor, que también reciben el tenantId como dato en vez
 * de inferirlo del request.
 */
@Injectable()
export class ReglasFiltroService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `condiciones: []` (sin condiciones) matchea a todos los clientes del
   * tenant — es el Filtro "todos", no un caso inválido.
   */
  async evaluar(tenantId: string, condiciones: FiltroCondicion[]): Promise<Cliente[]> {
    const ahora = new Date();
    const where: Prisma.ClienteWhereInput = {
      tenantId,
      AND: condiciones.map((condicion) => this.condicionAWhere(condicion, ahora)),
    };

    return this.prisma.cliente.findMany({ where });
  }

  private condicionAWhere(condicion: FiltroCondicion, ahora: Date): Prisma.ClienteWhereInput {
    switch (condicion.campo) {
      case ReglaFiltroCampo.TOTAL_PEDIDOS:
        return { totalPedidos: this.filtroNumerico(condicion.operador, condicion.valor) };
      case ReglaFiltroCampo.ULTIMO_PEDIDO_ANTIGUEDAD_DIAS:
        return { ultimoPedidoAt: this.filtroAntiguedad(condicion.operador, condicion.valor, ahora) };
      case ReglaFiltroCampo.PRIMER_PEDIDO_ANTIGUEDAD_DIAS:
        return { primerPedidoAt: this.filtroAntiguedad(condicion.operador, condicion.valor, ahora) };
      default:
        throw new BadRequestException(`Campo de filtro no soportado: ${condicion.campo}`);
    }
  }

  private filtroNumerico(operador: ReglaFiltroOperador, valor: number): Prisma.IntFilter {
    switch (operador) {
      case ReglaFiltroOperador.MAYOR_IGUAL:
        return { gte: valor };
      case ReglaFiltroOperador.MENOR_IGUAL:
        return { lte: valor };
      case ReglaFiltroOperador.IGUAL:
        return { equals: valor };
      default:
        throw new BadRequestException(`Operador no soportado: ${operador}`);
    }
  }

  /**
   * "Antigüedad en días" es tiempo transcurrido simple (ms ÷ 24h), no días
   * naturales/calendario ni depende de timezone — a diferencia de
   * common/horario.ts (que sí usa America/Mexico_City para horario de
   * negocio), aquí solo importa cuánto tiempo ha pasado desde `ahora`.
   *
   * IGUAL no está soportado sobre antigüedad (no tiene una interpretación
   * razonable para "días transcurridos desde ahora" con precisión de
   * milisegundos) — solo MAYOR_IGUAL/MENOR_IGUAL, como pide el Filtro.
   * "Antigüedad >= X días" es más vieja que X días → la fecha debe ser
   * igual o anterior a (ahora - X días), el inverso de una comparación
   * numérica directa.
   */
  private filtroAntiguedad(operador: ReglaFiltroOperador, dias: number, ahora: Date): Prisma.DateTimeFilter {
    const limite = new Date(ahora.getTime() - dias * MILISEGUNDOS_POR_DIA);
    switch (operador) {
      case ReglaFiltroOperador.MAYOR_IGUAL:
        return { lte: limite };
      case ReglaFiltroOperador.MENOR_IGUAL:
        return { gte: limite };
      default:
        throw new BadRequestException(
          `El operador ${operador} no aplica a un campo de antigüedad — usa MAYOR_IGUAL o MENOR_IGUAL.`,
        );
    }
  }
}
