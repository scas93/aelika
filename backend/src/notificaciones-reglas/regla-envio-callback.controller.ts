import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { BotAuthGuard } from '../auth/guards/bot-auth.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { Tenant } from '../../generated/prisma/client';
import { ReglaEnvioService } from './regla-envio.service';
import { ActualizarEstadoReglaEnvioDto } from './dto/actualizar-estado-regla-envio.dto';

/**
 * Recibe de Botpress el resultado asíncrono de un envío disparado por
 * ReglaEnvioService.enviar (ver ese servicio para el contrato completo del
 * flujo). @Public() a nivel de clase (salta el JwtAuthGuard/RolesGuard
 * globales, que no tienen sentido aquí) + BotAuthGuard por ruta — mismo
 * patrón que InternalController.getBotConfig, la única otra llamada
 * servidor-a-servidor Botpress -> Aelika que existe hoy.
 *
 * Contrato para configurar el lado de Botpress (Execute Code del workflow):
 *   PATCH /internal/reglas-envios/:id/estado
 *   Headers: X-Api-Key: <Tenant.botApiKey del negocio>
 *   Body:    { "estado": "EXITO" | "FALLO" }
 *   :id      = el `correlacionId` recibido en el payload del POST original
 *              (ver ReglaEnvioService.enviar) — es el id de ReglaEnvioLog.
 */
@Public()
@Controller('internal/reglas-envios')
export class ReglaEnvioCallbackController {
  constructor(private readonly reglaEnvioService: ReglaEnvioService) {}

  @UseGuards(BotAuthGuard)
  @Patch(':id/estado')
  actualizarEstado(
    @CurrentTenant() tenant: Tenant,
    @Param('id') id: string,
    @Body() dto: ActualizarEstadoReglaEnvioDto,
  ) {
    return this.reglaEnvioService.actualizarEstadoDesdeCallback(tenant.id, id, dto.estado);
  }
}
