import { Body, Controller, Post } from '@nestjs/common';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Role } from '../../../generated/prisma/enums';
import { AelikaScanLiteService } from './aelika-scan-lite.service';
import { EscanearLiteDto } from './dto/escanear-lite.dto';

// Sin tenant al que atar este endpoint — el Lite no pertenece a ningún
// negocio cliente de Aelika, solo exige estar logueado como Dueño de
// alguno (JwtAuthGuard/RolesGuard globales, ver CLAUDE.md), sin usar
// user.tenantId para nada.
@Roles(Role.DUENO)
@Controller('aelika-scan')
export class AelikaScanLiteController {
  constructor(private readonly aelikaScanLiteService: AelikaScanLiteService) {}

  @Post('lite')
  escanear(@Body() dto: EscanearLiteDto) {
    return this.aelikaScanLiteService.escanear(dto);
  }
}
