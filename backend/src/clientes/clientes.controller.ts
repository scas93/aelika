import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';
import { ClientesService } from './clientes.service';
import { ListClientesQueryDto } from './dto/list-clientes-query.dto';
import { SummaryQueryDto } from './dto/summary-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/enums';

// Abierto a los 3 roles desde Módulo 4 (Dashboard) — la card "Top clientes"
// de /dashboard reutiliza GET /clientes (ordenarPor=totalPedidos) y
// necesitaba que Operador pudiera llamarlo igual que el resto de tarjetas
// del dashboard, que ya estaban abiertas a los 3 roles. Antes esto era
// @Roles(GERENTE, DUENO) a propósito ("la cartera de clientes es
// información de gestión de negocio, no de surtido rutinario") — esa
// restricción se revirtió deliberadamente: Operador ahora puede consultar
// vía API el directorio completo (nombre/telefono/correo/fechas de
// cualquier cliente), no solo totalPedidos. La pantalla
// /dashboard/clientes conserva su propio gate de rol en el frontend
// (ClientesPage), así que Operador sigue sin ver esa UI — lo que cambió es
// solo el acceso a la API.
@Controller('clientes')
@Roles(Role.OPERADOR, Role.GERENTE, Role.DUENO)
export class ClientesController {
  constructor(private readonly clientesService: ClientesService) {}

  @Get()
  findAll(
    @Query() query: ListClientesQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.clientesService.findAll(query, user.tenantId);
  }

  // summaryDaily/activos alimentan el Dashboard (Inicio), no el directorio
  // de Clientes. Sus @Roles(...) de método quedaron redundantes al abrir
  // la clase completa arriba (mismo resultado con o sin ellos) — se dejan
  // tal cual en vez de limpiarlos, documentan la intención de cada
  // endpoint aunque ya no cambien el comportamiento.
  @Get('summary/daily')
  @Roles(Role.OPERADOR, Role.GERENTE, Role.DUENO)
  summaryDaily(@Query() query: SummaryQueryDto) {
    return this.clientesService.summaryDaily(query);
  }

  @Get('activos')
  @Roles(Role.OPERADOR, Role.GERENTE, Role.DUENO)
  activos(@CurrentUser() user: JwtPayload) {
    return this.clientesService.activos(user.tenantId);
  }
}
