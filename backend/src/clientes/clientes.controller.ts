import { Controller, Get, Query } from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { ListClientesQueryDto } from './dto/list-clientes-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';

// Mismo criterio que Catálogo/Promociones/PedidosB2b (escritura): la
// cartera de clientes es información de gestión de negocio, no de surtido
// rutinario — Operador no la ve. No hay escritura aquí, Cliente solo se
// modifica vía ClientesService.sincronizarDesdePedido (ver Etapa 1).
@Controller('clientes')
@Roles(Role.GERENTE, Role.DUENO)
export class ClientesController {
  constructor(private readonly clientesService: ClientesService) {}

  @Get()
  findAll(@Query() query: ListClientesQueryDto) {
    return this.clientesService.findAll(query);
  }
}
