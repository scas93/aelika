import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { PuntosEnvioService } from './puntos-envio.service';
import { CreatePuntoEnvioDto } from './dto/create-punto-envio.dto';
import { UpdatePuntoEnvioDto } from './dto/update-punto-envio.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';

@Controller('puntos-envio')
export class PuntosEnvioController {
  constructor(private readonly puntosEnvioService: PuntosEnvioService) {}

  // Any authenticated role of the tenant can view the delivery zones —
  // Operador needs this at checkout time same as Gerente/Dueño.
  @Get()
  findAll() {
    return this.puntosEnvioService.findAll();
  }

  @Roles(Role.DUENO)
  @Post()
  create(@Body() dto: CreatePuntoEnvioDto) {
    return this.puntosEnvioService.create(dto);
  }

  @Roles(Role.DUENO)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePuntoEnvioDto) {
    return this.puntosEnvioService.update(id, dto);
  }

  @Roles(Role.DUENO)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.puntosEnvioService.remove(id);
  }
}
