import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { TenantB2cPublicGuard } from '../pedidos-b2b/tenant-b2b.guard';
import { PublicService } from './public.service';
import { Public } from '../auth/decorators/public.decorator';
import { CreatePublicOrderDto } from './dto/create-public-order.dto';

@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  // Sin TenantB2cPublicGuard a propósito: el proxy y /tienda/[slug] lo usan para leer tipoStorefront y redirigir a /mayoreo.
  @Get('tenants/:slug')
  getTenant(@Param('slug') slug: string) {
    return this.publicService.getTenantInfo(slug);
  }

  @UseGuards(TenantB2cPublicGuard)
  @Get('tenants/:slug/catalog')
  getCatalog(@Param('slug') slug: string) {
    return this.publicService.getCatalog(slug);
  }

  @UseGuards(TenantB2cPublicGuard)
  @Get('tenants/:slug/puntos-envio')
  getPuntosEnvio(@Param('slug') slug: string) {
    return this.publicService.getPuntosEnvio(slug);
  }

  @UseGuards(TenantB2cPublicGuard)
  @Post('tenants/:slug/orders')
  createOrder(@Param('slug') slug: string, @Body() dto: CreatePublicOrderDto) {
    return this.publicService.createOrder(slug, dto);
  }

  @UseGuards(TenantB2cPublicGuard)
  @Get('tenants/:slug/orders/:id/estado-pago')
  getEstadoPago(@Param('slug') slug: string, @Param('id') id: string) {
    return this.publicService.getEstadoPago(slug, id);
  }
}
