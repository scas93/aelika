import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ReglasService } from './reglas.service';
import { CreateReglaDto } from './dto/create-regla.dto';
import { UpdateReglaDto } from './dto/update-regla.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';
import type { JwtPayload } from '../common/types/jwt-payload.type';

// Solo Dueño, en cualquier tipo de tenant (Gerente y Operador 403, ni siquiera el GET). Los canales y eventos de
// notificación (Ajustes) también son solo Dueño.
@Roles(Role.DUENO)
@Controller('reglas')
export class ReglasController {
  constructor(private readonly reglasService: ReglasService) {}

  @Get()
  findAll() {
    return this.reglasService.findAll();
  }

  // Antes de ':id' — de lo contrario Nest la matchearía como
  // GET /reglas/:id con id="catalogo-variables".
  @Get('catalogo-variables')
  catalogoVariables() {
    return this.reglasService.catalogoVariables();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.reglasService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateReglaDto) {
    return this.reglasService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateReglaDto) {
    return this.reglasService.update(id, dto);
  }

  @Post(':id/disparar')
  disparar(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.reglasService.dispararManual(id, user.tenantId);
  }
}
