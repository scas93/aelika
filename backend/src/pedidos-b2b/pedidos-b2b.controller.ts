import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PedidosB2bService } from './pedidos-b2b.service';
import { CreatePedidoB2bDto } from './dto/create-pedido-b2b.dto';
import { UpdatePedidoB2bItemsDto } from './dto/update-pedido-b2b-items.dto';
import { CerrarEntregaB2bDto } from './dto/cerrar-entrega-b2b.dto';
import { CorregirEntregaB2bDto } from './dto/corregir-entrega-b2b.dto';
import { ListPedidosB2bQueryDto } from './dto/list-pedidos-b2b-query.dto';
import { ExportPedidosB2bQueryDto } from './dto/export-pedidos-b2b-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '../../generated/prisma/enums';
import type { JwtPayload } from '../common/types/jwt-payload.type';
import { TenantB2bPanelGuard } from './tenant-b2b.guard';
import { XLSX_CONTENT_TYPE } from '../common/xlsx';
import { fechaMexicoYMD } from './pedidos-b2b-logica';

// Crear, pagar y corregir entregas cerradas: solo Gerente/Dueño. Editar, confirmar, cancelar y cerrar entregas: los 3
// roles (el Operador no puede editar ni cancelar un pedido Pagado). GET abierto a los 3 roles.
@UseGuards(TenantB2bPanelGuard)
@Controller('pedidos-b2b')
export class PedidosB2bController {
  constructor(private readonly pedidosB2bService: PedidosB2bService) {}

  @Get()
  findAll(@Query() query: ListPedidosB2bQueryDto) {
    return this.pedidosB2bService.findAll(query);
  }

  // Agregado para el módulo Inicio del panel (RETAIL_B2B) — mismo patrón que
  // GET /orders/summary (B2C). Debe ir antes de @Get(':id'), mismo motivo
  // que el resto de rutas estáticas de este controller.
  @Get('resumen')
  resumen() {
    return this.pedidosB2bService.resumen();
  }

  // Debe ir antes de @Get(':id') — mismo motivo que en OrdersController.
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="pedidos-b2b.csv"')
  exportCsv(@Query() query: ExportPedidosB2bQueryDto) {
    return this.pedidosB2bService.exportCsv(query);
  }

  // Excel (.xlsx) de Históricos y Pedidos activos (los 3 roles). El CSV de arriba queda sin uso por el panel.
  @Get('export-xlsx')
  async exportXlsx(@Query() query: ExportPedidosB2bQueryDto, @Res({ passthrough: true }) res: Response) {
    const buffer = await this.pedidosB2bService.exportPedidosXlsx(query);
    res.set({ 'Content-Type': XLSX_CONTENT_TYPE, 'Content-Disposition': `attachment; filename="pedidos-${fechaMexicoYMD()}.xlsx"` });
    return new StreamableFile(buffer);
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

  // Excel (.xlsx) de Entregas del día (los 3 roles). Antes de @Get(':id') por el mismo motivo que el resto de rutas estáticas.
  @Get('dia/:fecha/export-xlsx')
  async exportEntregasDiaXlsx(@Param('fecha') fecha: string, @Res({ passthrough: true }) res: Response) {
    const buffer = await this.pedidosB2bService.exportEntregasDiaXlsx(fecha);
    res.set({ 'Content-Type': XLSX_CONTENT_TYPE, 'Content-Disposition': `attachment; filename="entregas-${fecha}.xlsx"` });
    return new StreamableFile(buffer);
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

  // Editar, confirmar (avanzar) y cancelar están abiertos a los 3 roles; el servicio niega con 403 al Operador editar o
  // cancelar un pedido Pagado. Pagos y correcciones siguen siendo de admin.
  @Patch(':id/items')
  updateItems(@Param('id') id: string, @Body() dto: UpdatePedidoB2bItemsDto, @CurrentUser() user: JwtPayload) {
    return this.pedidosB2bService.updateItems(id, dto, user.rol);
  }

  @Patch(':id/avanzar')
  avanzar(@Param('id') id: string) {
    return this.pedidosB2bService.avanzar(id);
  }

  // Cerrar una entrega (Entregada / No recogida) es trabajo operativo: abierto a los 3 roles, a diferencia del resto de las
  // escrituras de este controller (Gerente/Dueño). Sin @Roles a propósito.
  @Patch(':id/entregas/:entregaId/cerrar')
  cerrarEntrega(@Param('id') id: string, @Param('entregaId') entregaId: string, @Body() dto: CerrarEntregaB2bDto) {
    return this.pedidosB2bService.cerrarEntrega(id, entregaId, dto);
  }

  // Corregir una entrega ya cerrada es de admin (Gerente/Dueño), a diferencia de cerrarla (operativo, los 3 roles).
  @Roles(Role.GERENTE, Role.DUENO)
  @Patch(':id/entregas/:entregaId/corregir')
  corregirEntrega(@Param('id') id: string, @Param('entregaId') entregaId: string, @Body() dto: CorregirEntregaB2bDto) {
    return this.pedidosB2bService.corregirEntrega(id, entregaId, dto);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Patch(':id/marcar-pagado')
  marcarPagado(@Param('id') id: string) {
    return this.pedidosB2bService.marcarPagado(id);
  }

  @Roles(Role.GERENTE, Role.DUENO)
  @Patch(':id/desmarcar-pagado')
  desmarcarPagado(@Param('id') id: string) {
    return this.pedidosB2bService.desmarcarPagado(id);
  }

  @Patch(':id/cancelar')
  cancelar(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.pedidosB2bService.cancelar(id, user.rol);
  }
}
