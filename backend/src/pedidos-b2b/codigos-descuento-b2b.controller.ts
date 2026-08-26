import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CodigosDescuentoB2bService } from './codigos-descuento-b2b.service';
import { CreateCodigoDescuentoB2bDto } from './dto/create-codigo-descuento-b2b.dto';
import { UpdateCodigoDescuentoB2bDto } from './dto/update-codigo-descuento-b2b.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';

// GET abierto a los 3 roles (se necesita para armar un PedidoB2b), escritura
// solo Gerente/Dueño — mismo criterio que Promociones.
@Controller('codigos-descuento-b2b')
export class CodigosDescuentoB2bController {
  constructor(
    private readonly codigosDescuentoB2bService: CodigosDescuentoB2bService,
  ) {}

  @Get()
  findAll() {
    return this.codigosDescuentoB2bService.findAll();
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Post()
  create(@Body() dto: CreateCodigoDescuentoB2bDto) {
    return this.codigosDescuentoB2bService.create(dto);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCodigoDescuentoB2bDto) {
    return this.codigosDescuentoB2bService.update(id, dto);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.codigosDescuentoB2bService.remove(id);
  }
}
