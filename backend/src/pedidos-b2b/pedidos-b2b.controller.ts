import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PedidosB2bService } from './pedidos-b2b.service';
import { CreatePedidoB2bDto } from './dto/create-pedido-b2b.dto';
import { UpdatePedidoB2bItemsDto } from './dto/update-pedido-b2b-items.dto';
import { ListPedidosB2bQueryDto } from './dto/list-pedidos-b2b-query.dto';
import { ExportPedidosB2bQueryDto } from './dto/export-pedidos-b2b-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/enums';
import type { JwtPayload } from '../common/types/jwt-payload.type';

// Escritura (crear/editar/avanzar/pagar/cancelar) restringida a
// Gerente/Dueño — mismo criterio que Catálogo/Promociones: a diferencia de
// Pedidos (pickup), este es un flujo de gestión de negocio, no de
// surtido rutinario. GET abierto a los 3 roles para que Operador pueda ver
// contexto igual que en el resto de la app.
@Controller('pedidos-b2b')
export class PedidosB2bController {
  constructor(private readonly pedidosB2bService: PedidosB2bService) {}

  @Get()
  findAll(@Query() query: ListPedidosB2bQueryDto) {
    return this.pedidosB2bService.findAll(query);
  }

  // Debe ir antes de @Get(':id') — mismo motivo que en OrdersController.
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="pedidos-b2b.csv"')
  exportCsv(@Query() query: ExportPedidosB2bQueryDto) {
    return this.pedidosB2bService.exportCsv(query);
  }

  // "Pedidos del día" — no colisiona con @Get(':id') (distinto número de
  // segmentos, Express solo hace match exacto de segmentos para :id), pero
  // se agrupa aquí junto al resto de rutas estáticas/especiales por
  // consistencia con el resto del controller.
  @Get('dia/:fecha')
  findEntregasDia(@Param('fecha') fecha: string) {
    return this.pedidosB2bService.findEntregasDia(fecha);
  }

  @Get('dia/:fecha/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="pedidos-b2b-dia.csv"')
  exportEntregasDiaCsv(@Param('fecha') fecha: string) {
    return this.pedidosB2bService.exportEntregasDiaCsv(fecha);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.pedidosB2bService.findOne(id);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePedidoB2bDto) {
    return this.pedidosB2bService.create(user.tenantId, dto);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Patch(':id/items')
  updateItems(@Param('id') id: string, @Body() dto: UpdatePedidoB2bItemsDto) {
    return this.pedidosB2bService.updateItems(id, dto);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Patch(':id/avanzar')
  avanzar(@Param('id') id: string) {
    return this.pedidosB2bService.avanzar(id);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Patch(':id/marcar-pagado')
  marcarPagado(@Param('id') id: string) {
    return this.pedidosB2bService.marcarPagado(id);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Patch(':id/cancelar')
  cancelar(@Param('id') id: string) {
    return this.pedidosB2bService.cancelar(id);
  }
}
