import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/enums';
import type { JwtPayload } from '../common/types/jwt-payload.type';

// The Dueño administers business settings — same criterion as /users.
@Roles(Role.DUENO)
@Controller('tenant')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get('me')
  getMine(@CurrentUser() user: JwtPayload) {
    return this.tenantService.getMine(user.tenantId);
  }

  @Patch('me')
  updateMine(@CurrentUser() user: JwtPayload, @Body() dto: UpdateTenantDto) {
    return this.tenantService.updateMine(user.tenantId, dto);
  }

  @Post('me/regenerate-bot-key')
  regenerateBotKey(@CurrentUser() user: JwtPayload) {
    return this.tenantService.regenerateBotKey(user.tenantId);
  }
}
