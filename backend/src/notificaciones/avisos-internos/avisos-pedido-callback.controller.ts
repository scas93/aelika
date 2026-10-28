import { Body, Controller, HttpCode, NotFoundException, Param, Patch, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../../auth/decorators/public.decorator';
import { BotAuthGuard } from '../../auth/guards/bot-auth.guard';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import type { Tenant } from '../../../generated/prisma/client';
import { sanearMotivo } from '../../portal/estado-envio-codigo.service';
import { AvisoPedidoModificadoService } from './aviso-pedido-modificado.service';

class ActualizarEstadoAvisoDto {
  @IsIn(['EXITO', 'FALLO'])
  estado!: 'EXITO' | 'FALLO';

  // Texto libre de Botpress (por qué falló). Se sanea antes de guardarlo.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

/**
 * Callback de Botpress con el resultado de un aviso interno (Cambio C). Hermano de los callbacks de reglas y del código del
 * portal (mismo guard: `X-Api-Key` = Tenant.botApiKey), con su propia ruta y su propia tabla.
 *
 *   PATCH /internal/avisos-pedido/:correlacionId/estado
 *   Headers: X-Api-Key: <Tenant.botApiKey del negocio>
 *   Body:    { "estado": "EXITO" | "FALLO", "motivo"?: string }
 *   Respuesta 200: { id, estado } — el estado vigente (un estado final no cambia; repetido = no-op).
 */
@Public()
@Controller('internal/avisos-pedido')
export class AvisosPedidoCallbackController {
  constructor(private readonly avisos: AvisoPedidoModificadoService) {}

  @UseGuards(BotAuthGuard)
  @Patch(':id/estado')
  @HttpCode(200)
  async actualizar(@CurrentTenant() tenant: Tenant, @Param('id') id: string, @Body() dto: ActualizarEstadoAvisoDto) {
    const r = await this.avisos.actualizarEstadoDesdeCallback(tenant.id, id, dto.estado, sanearMotivo(dto.motivo));
    // Mismo 404 para inexistente y de otro negocio.
    if (!r) throw new NotFoundException('No se encontró el envío');
    return r;
  }
}
