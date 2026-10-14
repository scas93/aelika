import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ModuloActivoGuard, RequiereModulo } from '../common/modulos';
import { LealtadService } from './lealtad.service';
import { AltaClienteLealtadDto } from './dto/alta-cliente-lealtad.dto';
import { TokenTarjetaDto } from './dto/token-tarjeta.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

// Abierto a los 3 roles — mismo criterio que /orders: es operación física
// del día a día (alta de cliente, sellar, redimir), probablemente Operador
// es quien está parado escaneando, no solo Gerente/Dueño. La protección de
// los 3 endpoints es la misma que la del resto del panel: JWT + RolesGuard
// (globales vía APP_GUARD) y aislamiento por tenant vía TenantPrismaService.
@UseGuards(ModuloActivoGuard)
@RequiereModulo('LEALTAD')
@Controller('lealtad')
@Roles(Role.OPERADOR, Role.GERENTE, Role.DUENO)
export class LealtadController {
  constructor(private readonly lealtadService: LealtadService) {}

  // Listado de solo lectura de los clientes inscritos. Abierto a los 3 roles
  // a propósito (incluye nombre/teléfono para el Operador, que atiende el
  // mostrador) — a diferencia de la pantalla /dashboard/clientes.
  @Get('clientes')
  listarInscritos(@CurrentUser() user: JwtPayload) {
    return this.lealtadService.listarInscritos(user.tenantId);
  }

  @Post('clientes')
  altaCliente(@Body() dto: AltaClienteLealtadDto) {
    return this.lealtadService.altaCliente(dto.nombre, dto.telefono);
  }

  @Post('registrar-compra')
  registrarCompra(@Body() dto: TokenTarjetaDto) {
    return this.lealtadService.registrarCompra(dto.token);
  }

  @Post('redimir-premio')
  redimirPremio(@Body() dto: TokenTarjetaDto) {
    return this.lealtadService.redimirPremio(dto.token);
  }
}
