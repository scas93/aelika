import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { NotificacionEventoConfigService } from './notificacion-evento-config.service';
import { CreateNotificacionEventoConfigDto } from './dto/create-notificacion-evento-config.dto';
import { UpdateNotificacionEventoConfigDto } from './dto/update-notificacion-evento-config.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';
import { Role } from '../../generated/prisma/enums';

@Roles(Role.DUENO)
@Controller('notificaciones/eventos')
export class NotificacionEventoConfigController {
  constructor(private readonly service: NotificacionEventoConfigService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.service.findAll(user.tenantId);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateNotificacionEventoConfigDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateNotificacionEventoConfigDto) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
