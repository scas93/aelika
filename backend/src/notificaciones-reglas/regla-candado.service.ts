import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReglaMensajeCategoria } from '../../generated/prisma/enums';

const DIAS_CANDADO_MARKETING = 7;
const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Candado de frecuencia: máximo 1 envío MARKETING por cliente cada 7 días,
 * global (cruza todas las Reglas, no solo la que se está evaluando).
 * UTILITY no tiene candado.
 *
 * `tenantId` explícito, mismo motivo que ReglasFiltroService: se llamará
 * desde un job sin sesión en la Etapa 2.
 */
@Injectable()
export class ReglaCandadoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * true = bloqueado (ya recibió un Marketing esta semana, no debe
   * enviarse este candidato). false = puede enviarse.
   */
  async estaBloqueado(
    tenantId: string,
    clienteId: string,
    categoria: ReglaMensajeCategoria,
  ): Promise<boolean> {
    if (categoria === ReglaMensajeCategoria.UTILITY) {
      return false;
    }

    const desde = new Date(Date.now() - DIAS_CANDADO_MARKETING * MILISEGUNDOS_POR_DIA);
    const envioReciente = await this.prisma.reglaEnvioLog.findFirst({
      where: {
        tenantId,
        clienteId,
        categoria: ReglaMensajeCategoria.MARKETING,
        createdAt: { gte: desde },
      },
      select: { id: true },
    });

    return envioReciente !== null;
  }
}
