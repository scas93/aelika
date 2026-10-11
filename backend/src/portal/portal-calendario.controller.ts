import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PortalAccesoService } from './portal-acceso.service';
import { PortalCalendarioService } from './portal-calendario.service';
import { exigirSesionPortal } from './portal-sesion-http';

class SlugQuery {
  @IsString() @IsNotEmpty() @Matches(/^[a-z0-9-]{1,80}$/) slug!: string;
}

// Calendario del portal del cliente B2B (Fase 4, 4c). Público (sin JWT del panel): la autorización es la sesión del portal.
@Public()
@Controller('portal')
export class PortalCalendarioController {
  constructor(
    private readonly acceso: PortalAccesoService,
    private readonly calendario: PortalCalendarioService,
  ) {}

  @Get('calendario')
  async obtener(
    @Query() q: SlugQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    const sesion = await exigirSesionPortal(this.acceso, req, res, q.slug);
    return this.calendario.calendario(sesion);
  }
}
