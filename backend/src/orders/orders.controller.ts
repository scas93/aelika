import { Controller, Get, Header, Param, Patch, Query } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { SummaryQueryDto } from './dto/summary-query.dto';
import { ListOrdersHistoricoQueryDto } from './dto/list-orders-historico-query.dto';
import { ExportOrdersHistoricoQueryDto } from './dto/export-orders-historico-query.dto';

// No @Roles() anywhere in this controller — unlike Catálogo (escritura solo
// gerente/dueno), Operador SÍ puede ver y avanzar pedidos (CLAUDE.md 1.4).
// Any authenticated role is allowed by default when no roles are declared.
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(@Query() query: ListOrdersQueryDto) {
    return this.ordersService.findAll(query);
  }

  // Must come before @Get(':id') — otherwise Nest's route matching would
  // treat "summary" as the :id param and never reach this handler.
  @Get('summary')
  summary(@Query() query: SummaryQueryDto) {
    return this.ordersService.summary(query);
  }

  @Get('summary/daily')
  summaryDaily(@Query() query: SummaryQueryDto) {
    return this.ordersService.summaryDaily(query);
  }

  // Must come before @Get(':id') — same reason as 'summary' above.
  @Get('historico')
  findAllHistorico(@Query() query: ListOrdersHistoricoQueryDto) {
    return this.ordersService.findAllHistorico(query);
  }

  // Must come before @Get(':id') for the same reason — Nest/Express would
  // otherwise treat "historico" as the :id param.
  @Get('historico/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="pedidos-historico.csv"')
  exportHistorico(@Query() query: ExportOrdersHistoricoQueryDto) {
    return this.ordersService.exportHistoricoCsv(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  @Patch(':id/avanzar')
  avanzar(@Param('id') id: string) {
    return this.ordersService.avanzar(id);
  }
}
