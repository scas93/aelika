import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReglaMensajeCategoria } from '../../generated/prisma/enums';
import type { Tenant } from '../../generated/prisma/client';

const DIAS_CANDADO_MARKETING_DEFAULT = 7;
const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Candado de frecuencia: máximo 1 envío MARKETING por cliente cada
 * `tenant.candadoMarketingDias` días (default 7 si el tenant no lo
 * configuró — ver el campo en schema.prisma), global (cruza todas las
 * Reglas, no solo la que se está evaluando). UTILITY no tiene candado.
 *
 * Recibe `tenant` completo (no solo `tenantId`) — todos los callers
 * (ReglaBarridoService, ReglaEventoPedidoService, ReglasService) ya lo
 * tienen a la mano vía `regla.tenant`, así que evita una consulta extra
 * solo para leer el umbral.
 */
@Injectable()
export class ReglaCandadoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * true = bloqueado (ya recibió un Marketing dentro del umbral, no debe
   * enviarse este candidato). false = puede enviarse.
   */
  async estaBloqueado(
    tenant: Tenant,
    clienteId: string,
    categoria: ReglaMensajeCategoria,
  ): Promise<boolean> {
    if (categoria === ReglaMensajeCategoria.UTILITY) {
      return false;
    }

    const dias = tenant.candadoMarketingDias ?? DIAS_CANDADO_MARKETING_DEFAULT;
    const desde = new Date(Date.now() - dias * MILISEGUNDOS_POR_DIA);
    const envioReciente = await this.prisma.reglaEnvioLog.findFirst({
      where: {
        tenantId: tenant.id,
        clienteId,
        categoria: ReglaMensajeCategoria.MARKETING,
        createdAt: { gte: desde },
      },
      select: { id: true },
    });

    return envioReciente !== null;
  }
}
