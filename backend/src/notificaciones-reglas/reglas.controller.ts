import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ReglasService } from './reglas.service';
import { CreateReglaDto } from './dto/create-regla.dto';
import { UpdateReglaDto } from './dto/update-regla.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/enums';
import type { JwtPayload } from '../common/types/jwt-payload.type';

// Restringido a DUENO en su totalidad (decisión de producto ya tomada,
// mismo criterio que TenantController/UsersController) — a diferencia de
// Catálogo/Promociones, ni siquiera el GET está abierto a otros roles.
@Roles(Role.DUENO)
@Controller('reglas')
export class ReglasController {
  constructor(private readonly reglasService: ReglasService) {}

  @Get()
  findAll() {
    return this.reglasService.findAll();
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
