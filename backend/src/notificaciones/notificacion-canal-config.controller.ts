import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { NotificacionCanalConfigService } from './notificacion-canal-config.service';
import { CreateNotificacionCanalConfigDto } from './dto/create-notificacion-canal-config.dto';
import { UpdateNotificacionCanalConfigDto } from './dto/update-notificacion-canal-config.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';

// Solo Dueño — mismo criterio que TenantController: esta pantalla vive bajo
// /dashboard/ajustes, que el propio frontend ya gatea a Dueño (ver
// AjustesPage), y el resto de endpoints de Ajustes (tenant/me, puntos-envio
// de escritura) siguen ese mismo patrón.
@Roles(Role.DUENO)
@Controller('notificaciones/canales')
export class NotificacionCanalConfigController {
  constructor(private readonly service: NotificacionCanalConfigService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  create(@Body() dto: CreateNotificacionCanalConfigDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNotificacionCanalConfigDto) {
    return this.service.update(id, dto);
  }

  // "Desconectar" un canal (Telegram) es borrar esta fila — cascada hacia
  // NotificacionEventoConfig (ver schema.prisma), así que también limpia
  // cualquier evento que apuntara a este canal. Reconectar es simplemente
  // rehacer el flujo de conexión, que crea una fila nueva.
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
