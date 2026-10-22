import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { BotAuthGuard } from '../auth/guards/bot-auth.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { Tenant } from '../../generated/prisma/client';
import { ReservasService } from './reservas.service';

/**
 * Ingesta servidor a servidor de reservas de hotel. Autenticación igual que bot-config: `X-Api-Key` = `Tenant.botApiKey`
 * (BotAuthGuard; @Public salta el JWT). Solo negocios HOTEL. Sin ValidationPipe/DTO a propósito: el cuerpo es el objeto de
 * Amenitiz tal cual, validado y mapeado en `parsearReservaAmenitiz`; los campos desconocidos se ignoran.
 */
@Public()
@Controller('internal/reservas')
export class ReservasController {
  constructor(private readonly reservasService: ReservasService) {}

  @UseGuards(BotAuthGuard)
  @Post('amenitiz')
  @HttpCode(200)
  ingestarAmenitiz(@CurrentTenant() tenant: Tenant, @Body() body: unknown) {
    return this.reservasService.ingestarAmenitiz(tenant, body);
  }
}
