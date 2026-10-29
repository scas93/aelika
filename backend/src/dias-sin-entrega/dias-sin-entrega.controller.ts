import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';
import { TenantB2bPanelGuard } from '../pedidos-b2b/tenant-b2b.guard';
import { DiasSinEntregaService } from './dias-sin-entrega.service';
import { CreateDiaSinEntregaDto } from './dto/create-dia-sin-entrega.dto';

// Leer la lista: los 3 roles (el selector de fechas del panel la necesita). Marcar y quitar: Gerente/Dueño; el Operador da 403.
@UseGuards(TenantB2bPanelGuard)
@Controller('dias-sin-entrega')
export class DiasSinEntregaController {
  constructor(private readonly service: DiasSinEntregaService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Post()
  create(@Body() dto: CreateDiaSinEntregaDto) {
    return this.service.create(dto);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
