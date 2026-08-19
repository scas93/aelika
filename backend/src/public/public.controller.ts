import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PublicService } from './public.service';
import { Public } from '../auth/decorators/public.decorator';
import { CreatePublicOrderDto } from './dto/create-public-order.dto';

@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('tenants/:slug')
  getTenant(@Param('slug') slug: string) {
    return this.publicService.getTenantInfo(slug);
  }

  @Get('tenants/:slug/catalog')
  getCatalog(@Param('slug') slug: string) {
    return this.publicService.getCatalog(slug);
  }

  @Get('tenants/:slug/puntos-envio')
  getPuntosEnvio(@Param('slug') slug: string) {
    return this.publicService.getPuntosEnvio(slug);
  }

  @Post('tenants/:slug/orders')
  createOrder(@Param('slug') slug: string, @Body() dto: CreatePublicOrderDto) {
    return this.publicService.createOrder(slug, dto);
  }
}
