import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PublicPedidosB2bService } from './public-pedidos-b2b.service';
import { CreatePedidoB2bDto } from './dto/create-pedido-b2b.dto';
import { Public } from '../auth/decorators/public.decorator';

// Storefront público de pedidos B2B — mismo patrón que PublicController
// (public/): @Public() a nivel de clase, tenant resuelto por slug, sin JWT.
// Prefijo propio (public/pedidos-b2b/...) para no tocar/chocar con las
// rutas de PublicController (public/tenants/...).
@Public()
@Controller('public/pedidos-b2b')
export class PublicPedidosB2bController {
  constructor(
    private readonly publicPedidosB2bService: PublicPedidosB2bService,
  ) {}

  @Get('tenants/:slug')
  getTenant(@Param('slug') slug: string) {
    return this.publicPedidosB2bService.getTenantInfo(slug);
  }

  @Get('tenants/:slug/catalog')
  getCatalog(@Param('slug') slug: string) {
    return this.publicPedidosB2bService.getCatalog(slug);
  }

  @Get('tenants/:slug/codigos-descuento/:codigo')
  previewCodigoDescuento(
    @Param('slug') slug: string,
    @Param('codigo') codigo: string,
  ) {
    return this.publicPedidosB2bService.previewCodigoDescuento(slug, codigo);
  }

  @Post('tenants/:slug/pedidos')
  createPedido(@Param('slug') slug: string, @Body() dto: CreatePedidoB2bDto) {
    return this.publicPedidosB2bService.createPedido(slug, dto);
  }
}
