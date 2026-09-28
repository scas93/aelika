import { Body, Controller, Post } from '@nestjs/common';
import { LealtadService } from './lealtad.service';
import { AltaClienteLealtadDto } from './dto/alta-cliente-lealtad.dto';
import { TokenTarjetaDto } from './dto/token-tarjeta.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';

// Abierto a los 3 roles — mismo criterio que /orders: es operación física
// del día a día (alta de cliente, sellar, redimir), probablemente Operador
// es quien está parado escaneando, no solo Gerente/Dueño. La protección de
// los 3 endpoints es la misma que la del resto del panel: JWT + RolesGuard
// (globales vía APP_GUARD) y aislamiento por tenant vía TenantPrismaService.
@Controller('lealtad')
@Roles(Role.OPERADOR, Role.GERENTE, Role.DUENO)
export class LealtadController {
  constructor(private readonly lealtadService: LealtadService) {}

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
