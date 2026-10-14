import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClientesB2bService } from './clientes-b2b.service';
import { CreateClienteB2bDto } from './dto/create-cliente-b2b.dto';
import { UpdateClienteB2bDto } from './dto/update-cliente-b2b.dto';
import { ListClientesB2bQueryDto } from './dto/list-clientes-b2b-query.dto';
import {
  TelefonoClienteB2bDto,
  UpdateTelefonoClienteB2bDto,
} from './dto/telefono-cliente-b2b.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/enums';
import type { JwtPayload } from '../common/types/jwt-payload.type';
import { TenantB2bPanelGuard } from '../pedidos-b2b/tenant-b2b.guard';

// Clientes de mayoreo (solo tenants RETAIL_B2B). Todo es de Gerente/Dueño salvo el selector, que el Operador
// necesita para elegir cliente al capturar un pedido y solo devuelve id, nombre, código y descuento.
@UseGuards(TenantB2bPanelGuard)
@Roles(Role.GERENTE, Role.DUENO)
@Controller('clientes-b2b')
export class ClientesB2bController {
  constructor(private readonly clientesB2bService: ClientesB2bService) {}

  // Rutas estáticas antes de ':id'.
  @Get('selector')
  @Roles(Role.OPERADOR, Role.GERENTE, Role.DUENO)
  selector() {
    return this.clientesB2bService.selector();
  }

  @Get()
  findAll(@Query() query: ListClientesB2bQueryDto) {
    return this.clientesB2bService.findAll(query);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateClienteB2bDto) {
    return this.clientesB2bService.create(user.tenantId, dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.clientesB2bService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateClienteB2bDto) {
    return this.clientesB2bService.update(id, dto);
  }

  @Post(':id/baja')
  baja(@Param('id') id: string) {
    return this.clientesB2bService.baja(id);
  }

  @Post(':id/reactivar')
  reactivar(@Param('id') id: string) {
    return this.clientesB2bService.reactivar(id);
  }

  @Post(':id/telefonos')
  agregarTelefono(@Param('id') id: string, @Body() dto: TelefonoClienteB2bDto) {
    return this.clientesB2bService.agregarTelefono(id, dto);
  }

  @Patch(':id/telefonos/:telefonoId')
  editarTelefono(
    @Param('id') id: string,
    @Param('telefonoId') telefonoId: string,
    @Body() dto: UpdateTelefonoClienteB2bDto,
  ) {
    return this.clientesB2bService.editarTelefono(id, telefonoId, dto);
  }

  @Post(':id/telefonos/:telefonoId/principal')
  cambiarPrincipal(
    @Param('id') id: string,
    @Param('telefonoId') telefonoId: string,
  ) {
    return this.clientesB2bService.cambiarPrincipal(id, telefonoId);
  }

  @Delete(':id/telefonos/:telefonoId')
  quitarTelefono(
    @Param('id') id: string,
    @Param('telefonoId') telefonoId: string,
  ) {
    return this.clientesB2bService.quitarTelefono(id, telefonoId);
  }
}
