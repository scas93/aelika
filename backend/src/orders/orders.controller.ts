import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';

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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  @Patch(':id/avanzar')
  avanzar(@Param('id') id: string) {
    return this.ordersService.avanzar(id);
  }
}
