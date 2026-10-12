import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PublicPedidosB2bService } from './public-pedidos-b2b.service';
import { Public } from '../auth/decorators/public.decorator';
import { TenantB2bPublicGuard } from './tenant-b2b.guard';

// Storefront público de pedidos B2B — mismo patrón que PublicController
// (public/): @Public() a nivel de clase, tenant resuelto por slug, sin JWT.
// Prefijo propio (public/pedidos-b2b/...) para no tocar/chocar con las
// rutas de PublicController (public/tenants/...).
@Public()
@UseGuards(TenantB2bPublicGuard)
@Controller('public/pedidos-b2b')
export class PublicPedidosB2bController {
  constructor(
    private readonly publicPedidosB2bService: PublicPedidosB2bService,
  ) {}

  @Get('tenants/:slug')
  getTenant(@Param('slug') slug: string) {
    return this.publicPedidosB2bService.getTenantInfo(slug);
  }

  // El catálogo de mayoreo y la vista previa de códigos de descuento ya NO son públicos (Fase 4, 4d): el catálogo y los
  // precios solo se ven con sesión del portal (GET /portal/catalogo) y el descuento es un % del cliente, no un código.

  // Cerrado: los pedidos de mayoreo se crean desde el portal con sesión (POST /portal/pedidos). Sin @Body a propósito,
  // siempre 409 con el mismo mensaje.
  @Post('tenants/:slug/pedidos')
  createPedido(@Param('slug') slug: string) {
    return this.publicPedidosB2bService.rechazarPedidoAnonimo(slug);
  }
}
