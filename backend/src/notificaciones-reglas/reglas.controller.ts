import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ReglasService } from './reglas.service';
import { CreateReglaDto } from './dto/create-regla.dto';
import { UpdateReglaDto } from './dto/update-regla.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ReglasAccesoGuard } from './reglas-acceso.guard';
import type { JwtPayload } from '../common/types/jwt-payload.type';

// Dueño siempre; Gerente solo en tenants RETAIL_B2B (ReglasAccesoGuard); Operador nunca — ni siquiera el GET. En
// RETAIL_B2C sigue siendo solo Dueño.
@UseGuards(ReglasAccesoGuard)
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
