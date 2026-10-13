import {
  Body,
  Controller,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Patch,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { BotAuthGuard } from '../auth/guards/bot-auth.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { Tenant } from '../../generated/prisma/client';
import {
  EstadoEnvioCodigoService,
  sanearMotivo,
} from './estado-envio-codigo.service';

class ActualizarEstadoCodigoDto {
  @IsIn(['EXITO', 'FALLO'])
  estado!: 'EXITO' | 'FALLO';

  // Texto libre de Botpress (por qué falló). Se sanea antes de escribirlo en el registro del servidor.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

/**
 * Callback de Botpress con el resultado de un código de acceso enviado por WhatsApp (4g). Hermano del callback de las
 * reglas de pedidos (que no se toca): mismo guard (`X-Api-Key` = Tenant.botApiKey), pero el estado vive en Redis, no en
 * ReglaEnvioLog. No cambia nada de lo que ve el cliente en el portal: solo informa al equipo técnico.
 *
 *   PATCH /internal/portal-codigos/:correlacionId/estado
 *   Headers: X-Api-Key: <Tenant.botApiKey del negocio>
 *   Body:    { "estado": "EXITO" | "FALLO", "motivo": "opcional" }
 *   :correlacionId = el `correlacionId` recibido en el POST original.
 */
@Public()
@Controller('internal/portal-codigos')
export class PortalCodigosCallbackController {
  private readonly logger = new Logger(PortalCodigosCallbackController.name);

  constructor(private readonly estados: EstadoEnvioCodigoService) {}

  @UseGuards(BotAuthGuard)
  @Patch(':id/estado')
  @HttpCode(200)
  async actualizar(
    @CurrentTenant() tenant: Tenant,
    @Param('id') id: string,
    @Body() dto: ActualizarEstadoCodigoDto,
  ) {
    const motivo = sanearMotivo(dto.motivo);
    let r: Awaited<ReturnType<EstadoEnvioCodigoService['cerrar']>>;
    try {
      r = await this.estados.cerrar(id, tenant.id, dto.estado, motivo);
    } catch (error: unknown) {
      this.logger.error(
        `Redis no responde en el callback del código: ${String(error)}`,
      );
      throw new ServiceUnavailableException(
        'Servicio no disponible, reintenta',
      );
    }
    // Mismo 404 para inexistente, vencido y de otro negocio.
    if (!r) throw new NotFoundException('Envío no encontrado');
    if (r.cambio && dto.estado === 'FALLO') {
      this.logger.warn(
        `Envío del código de acceso fallido según Botpress (negocio=${tenant.slug}, correlacion=${id})${motivo ? `: ${motivo}` : ''}`,
      );
    }
    return { id, estado: r.registro.estado };
  }
}
