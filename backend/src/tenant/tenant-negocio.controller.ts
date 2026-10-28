import { Body, Controller, Get, Patch } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { UpdateNegocioDto } from './dto/update-negocio.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/enums';
import type { JwtPayload } from '../common/types/jwt-payload.type';

// "Información del negocio" (Ajustes): Dueño y Gerente. Recurso aparte de /tenant/me (solo Dueño) para que el Gerente nunca
// pueda leer ni escribir facturación, Stripe, llave/webhook del bot ni la configuración de mayoreo.
@Roles(Role.DUENO, Role.GERENTE)
@Controller('tenant/negocio')
export class TenantNegocioController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  get(@CurrentUser() user: JwtPayload) {
    return this.tenantService.getNegocio(user.tenantId, user.rol);
  }

  @Patch()
  update(@CurrentUser() user: JwtPayload, @Body() dto: UpdateNegocioDto) {
    return this.tenantService.updateNegocio(user.tenantId, user.rol, dto);
  }
}
