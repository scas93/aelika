import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { LealtadService } from './lealtad.service';
import { LealtadPinGuard } from './guards/lealtad-pin.guard';
import { AltaClienteLealtadDto } from './dto/alta-cliente-lealtad.dto';
import { VerificacionPinDto } from './dto/verificacion-pin.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';

// Abierto a los 3 roles — mismo criterio que /orders: es operación física
// del día a día (alta de cliente, sellar, redimir), probablemente Operador
// es quien está parado con el PIN escaneando, no solo Gerente/Dueño.
@Controller('lealtad')
@Roles(Role.OPERADOR, Role.GERENTE, Role.DUENO)
export class LealtadController {
  constructor(private readonly lealtadService: LealtadService) {}

  // Sin PIN — el PIN protege únicamente registrar-compra/redimir-premio,
  // no la alta.
  @Post('clientes')
  altaCliente(@Body() dto: AltaClienteLealtadDto) {
    return this.lealtadService.altaCliente(dto.nombre, dto.telefono);
  }

  @Post('registrar-compra')
  @UseGuards(LealtadPinGuard)
  registrarCompra(@Body() dto: VerificacionPinDto) {
    return this.lealtadService.registrarCompra(dto.token);
  }

  @Post('redimir-premio')
  @UseGuards(LealtadPinGuard)
  redimirPremio(@Body() dto: VerificacionPinDto) {
    return this.lealtadService.redimirPremio(dto.token);
  }
}
