import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { NotificacionEventoConfigService } from './notificacion-evento-config.service';
import { CreateNotificacionEventoConfigDto } from './dto/create-notificacion-evento-config.dto';
import { UpdateNotificacionEventoConfigDto } from './dto/update-notificacion-evento-config.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';

@Roles(Role.DUENO)
@Controller('notificaciones/eventos')
export class NotificacionEventoConfigController {
  constructor(private readonly service: NotificacionEventoConfigService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateNotificacionEventoConfigDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNotificacionEventoConfigDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
